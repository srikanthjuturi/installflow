"""Reading the penalty pool.

Read-only, and that is not a stage it is passing through. Nothing here writes:
a ledger entry is created by the act it records — a cancellation in
`jobs.service.cancel`, a completed bonused job in `jobs.service.complete` — and
it commits in that act's own transaction. An endpoint that could post an entry
on its own would be a way to move money without anything happening.

## Scoped by company only

Unlike tickets and technicians, this is NOT narrowed by territory. The pool is
one balance for the whole company — §7 collects every cancellation into it and
funds every bonus out of it — so a per-region view would show a share of a
number that is not divisible. The `earnings.view` feature is admin and national
head by default, which is the audience that reads a whole-company figure.
"""

import uuid

from sqlalchemy import Select, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ledger import pool as pool_totals
from app.core.schemas import ListParams
from app.db.repository import paginate
from app.features.ledger.schemas import LedgerEntryOut, LedgerPoolOut
from app.models.ledger import POOL_KINDS, LedgerEntry
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.user import User


async def get_pool(db: AsyncSession, *, company_id: uuid.UUID) -> LedgerPoolOut:
    return LedgerPoolOut(**await pool_totals(db, company_id=company_id))


def _entries_query(*, company_id: uuid.UUID, kind: str | None) -> Select:
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
    """
    stmt = select(LedgerEntry).where(
        LedgerEntry.company_id == company_id,
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
    kind: str | None = None,
) -> tuple[list[LedgerEntryOut], int]:
    """One page of the ledger, with the two names each row shows.

    Names are resolved per page rather than joined into the query, for the
    reason `tickets._hydrate` does it: two small `IN` lookups over a page of
    twenty beat a four-table join that the count query would then have to
    repeat.
    """
    rows, total = await paginate(
        db, _entries_query(company_id=company_id, kind=kind),
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
        )
        for e in rows
    ], total
