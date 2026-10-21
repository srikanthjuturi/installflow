"""Reading the penalty pool — one pool per franchisee (F12, Task 05 §4.12).

Writes: `POST /franchise/ledger/{entryId}/reverse` is the ONE write here, the
franchisee's own Door 2 for giving a penalty back — everything else still
writes nothing. An entry is otherwise created by the act it records — a
cancellation in `jobs.service.cancel`, a completed bonused job in
`jobs.service.complete`, a penalty given back in `core.penalty_reversal` — and
it commits in that act's own transaction. An endpoint that could post an entry
on its own would be a way to move money without anything happening.

## Scoped by company and franchisee

Unlike tickets and technicians, this is NOT narrowed by territory. The pool is
ONE BALANCE PER FRANCHISEE — §7 collects every cancellation into it and funds
every bonus out of it — so a per-region view would show a share of a number
that is not divisible. The `earnings.view` feature is admin and national head
by default, which is the audience that reads a whole-company figure; a
franchisee's own admin reads its own through the `/franchise` twins
(`franchise.pool`), and every pool read here names the franchisee it is about
(`core.franchise_money.pool_franchisee` decides which).
"""

import uuid

from sqlalchemy import Select, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.errors import AppError
from app.core.ledger import pool
from app.core.penalty_reversal import REVERSIBLE_KINDS, reverse
from app.core.schemas import ListParams
from app.db.repository import paginate
from app.features.ledger.schemas import LedgerEntryOut, LedgerPoolOut
from app.models.franchisee import Franchisee
from app.models.ledger import POOL_KINDS, LedgerEntry
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.user import User


async def get_pool(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> LedgerPoolOut:
    """One franchisee's pool — `franchisee_id` is not optional here.

    The caller (`core.franchise_money.pool_franchisee`) decided WHICH pool the
    read is about; the name rides along so the console can title the screen
    with it rather than remembering what it asked for.
    """
    return LedgerPoolOut(
        **await pool(db, company_id=company_id, franchisee_id=franchisee_id),
        franchiseeId=franchisee_id,
        franchiseeName=(
            await db.scalar(
                select(Franchisee.name).where(
                    Franchisee.company_id == company_id,
                    Franchisee.id == franchisee_id,
                )
            )
            or ""
        ),
    )


def _entries_query(
    *, company_id: uuid.UUID, franchisee_id: uuid.UUID, kind: str | None
) -> Select:
    """Newest first, which is the only order a ledger is read in.

    Ordered by `created_at` and then `id`: two entries written in one
    transaction share a timestamp — a cancellation's penalty and, on another
    ticket, a completion's bonus can land in the same tick — and an unstable
    sort makes a page boundary drop or repeat a row.

    **Restricted to `POOL_KINDS`, and that is not a filter you may drop.** This
    screen is the penalty POOL: its heading is a balance, its two columns are
    what was collected and what was paid out of it, and every row is expected to
    be one side of that circuit. A job payout shares this table — same person,
    same ticket, and the technician's own Earnings screen reads all three as one
    list — but it is not pool money: it is the company paying for work, funded
    from outside. Left unfiltered it would list ordinary wages under a balance
    it is not part of, and the totals beside it would not add up to the rows.

    Technician earnings are `features/earnings`, which reads the same table from
    the other end and deliberately does NOT filter by kind.

    Task 05 §4.12: and to ONE franchisee's rows — every entry is stamped
    (F12), so the balance the screen leads with and the rows under it finally
    cannot disagree about whose money they describe.
    """
    stmt = select(LedgerEntry).where(
        LedgerEntry.company_id == company_id,
        LedgerEntry.franchisee_id == franchisee_id,
        LedgerEntry.kind.in_(POOL_KINDS),
    )
    if kind is not None:
        stmt = stmt.where(LedgerEntry.kind == kind)
    return stmt.order_by(desc(LedgerEntry.created_at), desc(LedgerEntry.id))


async def list_entries(
    db: AsyncSession,
    params: ListParams,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    kind: str | None = None,
) -> tuple[list[LedgerEntryOut], int]:
    """One page of the ledger, with the two names each row shows.

    Names are resolved per page rather than joined into the query, for the
    reason `tickets._hydrate` does it: two small `IN` lookups over a page of
    twenty beat a four-table join that the count query would then have to
    repeat.
    """
    rows, total = await paginate(
        db, _entries_query(company_id=company_id, franchisee_id=franchisee_id, kind=kind),
        page=params.page, limit=params.limit,
    )
    if not rows:
        return [], total

    codes = {
        r[0]: r[1]
        for r in await db.execute(
            select(Ticket.id, Ticket.code).where(
                Ticket.id.in_({e.ticket_id for e in rows})
            )
        )
    }
    # A technician's name is on the User the membership points at, not on the
    # profile — the same two-hop join `tickets._hydrate` makes.
    names = {
        r[0]: r[1]
        for r in await db.execute(
            select(TechnicianProfile.id, User.full_name)
            .join(Membership, Membership.id == TechnicianProfile.membership_id)
            .join(User, User.id == Membership.user_id)
            .where(TechnicianProfile.id.in_({e.technician_id for e in rows}))
        )
    }
    # Which penalties on this page have been given back. Asked of the reversal
    # rows, across every page — the reversal is usually newer than its penalty
    # and so sits on an EARLIER page than the charge it tags.
    penalty_ids = {e.id for e in rows if e.kind == "penalty"}
    reversed_ids = (
        set(
            await db.scalars(
                select(LedgerEntry.reverses_id).where(
                    LedgerEntry.company_id == company_id,
                    LedgerEntry.reverses_id.in_(penalty_ids),
                )
            )
        )
        if penalty_ids
        else set()
    )

    return [
        LedgerEntryOut(
            id=e.id,
            at=e.created_at,
            kind=e.kind,
            amountPaise=e.amount_paise,
            technicianId=e.technician_id,
            technicianName=names.get(e.technician_id) or "—",
            ticketId=e.ticket_id,
            ticketCode=codes.get(e.ticket_id) or "—",
            reason=e.reason,
            reversed=e.id in reversed_ids,
            # The stamps Task 05 put on every row (F12) — which pool the
            # money belongs to, and the stream it came from.
            franchiseeId=e.franchisee_id,
            technicianType=e.technician_type,
        )
        for e in rows
    ], total


def _not_found() -> AppError:
    # 404, never 403: a penalty not visible to this door does not exist to it.
    return AppError(404, "NOT_FOUND", "Penalty not found")


async def reverse_entry(
    db: AsyncSession, principal: Principal, entry_id: uuid.UUID, reason: str
) -> LedgerEntryOut:
    """Door 2 — the franchisee's own admin gives one of its penalties back.

    Reachable only from `POST /franchise/ledger/{entryId}/reverse`, so the
    authorisation is exactly the stamp: the penalty must carry the
    principal's own `franchisee_id`, be one whose kind can be reversed, and be
    this company's — any miss is 404 "Penalty not found", never 403. How the
    reversal is written, the event, the push and the once-only guarantee are
    all `core.penalty_reversal.reverse` — the ONE body both doors share
    (§4.10/§4.12); Door 1's territory check does not apply here, F13 having
    kept the franchise principal out of tickets altogether.
    """
    assert principal.company_id is not None and principal.franchisee_id is not None
    penalty = await db.scalar(
        select(LedgerEntry).where(
            LedgerEntry.company_id == principal.company_id,
            LedgerEntry.id == entry_id,
            LedgerEntry.kind.in_(REVERSIBLE_KINDS),
            LedgerEntry.franchisee_id == principal.franchisee_id,
        )
    )
    if penalty is None:
        raise _not_found()
    ticket = await db.scalar(
        select(Ticket).where(
            Ticket.company_id == principal.company_id,
            Ticket.id == penalty.ticket_id,
        )
    )
    if ticket is None:
        # RESTRICT on the FK makes this unreachable; refuse rather than guess.
        raise _not_found()
    reversal = await reverse(
        db,
        penalty=penalty,
        ticket=ticket,
        reason=reason,
        actor_user_id=principal.user_id,
        actor_label=(principal.user.full_name or "").strip() or "—",
    )
    # Same two lookups `list_entries` makes, for one row.
    code = await db.scalar(select(Ticket.code).where(Ticket.id == reversal.ticket_id))
    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .join(TechnicianProfile, TechnicianProfile.membership_id == Membership.id)
        .where(TechnicianProfile.id == reversal.technician_id)
    )
    return LedgerEntryOut(
        id=reversal.id,
        at=reversal.created_at,
        kind=reversal.kind,
        amountPaise=reversal.amount_paise,
        technicianId=reversal.technician_id,
        technicianName=name or "—",
        ticketId=reversal.ticket_id,
        ticketCode=code or "—",
        reason=reversal.reason,
        reversed=False,
        franchiseeId=reversal.franchisee_id,
        technicianType=reversal.technician_type,
    )
