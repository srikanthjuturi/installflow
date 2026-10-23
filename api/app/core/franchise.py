"""Which franchisee owns what — the one place that answers it.

Core, not a slice, because companies, technicians, onboarding, tickets and
redemptions all need this — api hard rule 4 (slices never import each other).
The two pure functions import only `app.models.*`, so they are unit-testable
with no database.
"""

import uuid
from collections.abc import Iterable, Mapping

from sqlalchemy import Select, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.franchise_routing import codes_outside, needs_restamp, outside_message
from app.core.travel_rules import stamp_travel_rules
from app.models.company import Company
from app.models.franchisee import HOME_CODE, KIND_INTERNAL, MAX_NAME, Franchisee, FranchiseePincode
from app.models.territory import Pincode
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent


def home_franchisee_fields(company_name: str) -> dict:
    """PURE. The column values of a company's home franchisee — the migration's INSERT says the same."""
    return {
        "name": company_name[:MAX_NAME],
        "code": HOME_CODE,
        "kind": KIND_INTERNAL,
        "is_home": True,
        "is_active": True,
    }


def route_pincodes(
    pincodes: Iterable[str], owned: Mapping[str, uuid.UUID], home_id: uuid.UUID
) -> dict[str, uuid.UUID]:
    """PURE. Each pincode's franchisee: its owner row, else the home (F4)."""
    return {p: owned.get(p, home_id) for p in set(pincodes)}


async def create_home_franchisee(db: AsyncSession, company: Company) -> Franchisee:
    """Write the company's home. Flushes, never commits — the caller owns the transaction, exactly as
    `rules.load_rules` and `credits.grant_free` do inside `create_company`.

    Task 10 stamps the home's two travel-rule rows here too (TA4), from the same
    defaults every franchisee starts on — `load_travel_rule` would self-heal them
    anyway, but a company born after the publish should simply have them."""
    row = Franchisee(
        company_id=company.id, created_by=company.created_by, **home_franchisee_fields(company.name)
    )
    db.add(row)
    await db.flush()
    await stamp_travel_rules(
        db, company_id=company.id, franchisee_id=row.id, by_user=company.created_by
    )
    return row


async def home_franchisee_id(db: AsyncSession, company_id: uuid.UUID) -> uuid.UUID:
    """The company's home. Self-heals like `rules.load_rules`: a company created by the OLD code between
    the production migration and the publish has none (see the migration's own docstring), and its first
    ticket must not 500 for that. Concurrent repairs collide on uq_franchisees_one_home -> errors.py 409,
    and the retry finds the row."""
    found = await db.scalar(
        select(Franchisee.id).where(
            Franchisee.company_id == company_id,
            Franchisee.is_home.is_(True),
            Franchisee.deleted_at.is_(None),
        )
    )
    if found is not None:
        return found
    company = await db.scalar(select(Company).where(Company.id == company_id))
    if company is None:
        raise LookupError(f"company {company_id} does not exist")
    return (await create_home_franchisee(db, company)).id


async def franchisee_for_pincode(db: AsyncSession, company_id: uuid.UUID, pincode: str) -> uuid.UUID:
    """The owner of this pincode in this company, else the home. One indexed probe
    (uq_franchisee_pincodes_company_pincode) plus, on a miss, the home lookup."""
    owner = await db.scalar(
        select(FranchiseePincode.franchisee_id)
        .join(
            Franchisee,
            (Franchisee.company_id == FranchiseePincode.company_id)
            & (Franchisee.id == FranchiseePincode.franchisee_id),
        )
        .where(
            FranchiseePincode.company_id == company_id,
            FranchiseePincode.pincode == pincode,
            Franchisee.deleted_at.is_(None),
        )
    )
    return owner if owner is not None else await home_franchisee_id(db, company_id)


async def franchisees_for_pincodes(
    db: AsyncSession, company_id: uuid.UUID, pincodes: Iterable[str]
) -> dict[str, uuid.UUID]:
    """`franchisee_for_pincode` for a whole sheet in TWO queries, for the bulk importer (which exists to
    avoid per-row queries)."""
    wanted = set(pincodes)
    if not wanted:
        return {}
    rows = await db.execute(
        select(FranchiseePincode.pincode, FranchiseePincode.franchisee_id)
        .join(
            Franchisee,
            (Franchisee.company_id == FranchiseePincode.company_id)
            & (Franchisee.id == FranchiseePincode.franchisee_id),
        )
        .where(
            FranchiseePincode.company_id == company_id,
            FranchiseePincode.pincode.in_(wanted),
            Franchisee.deleted_at.is_(None),
        )
    )
    return route_pincodes(wanted, dict(rows.all()), await home_franchisee_id(db, company_id))


def franchisee_pincodes_subquery(
    company_id: uuid.UUID, franchisee_id: uuid.UUID, *, is_home: bool
) -> Select:
    """SQL, never a list: the codes a franchisee owns.

    Non-home: its own rows. Home: every ACTIVE master code that no franchisee in this company owns (F4) —
    thousands of codes, which is why this is a subquery for Postgres to filter with, never materialised
    (the `core.scope.pincodes_in_states` rule). `NOT IN` is safe: `franchisee_pincodes.pincode` is NOT
    NULL, so the NULL trap cannot fire.

    For PICKING and RANGE checks (Tasks 03, 04, 14). Ticket and technician VISIBILITY go by the stamped
    `franchisee_id` column, never by this (Task 02) — after a carve-out an assigned ticket keeps its
    franchisee while its pincode now belongs to another.
    """
    if not is_home:
        return select(FranchiseePincode.pincode).where(
            FranchiseePincode.company_id == company_id, FranchiseePincode.franchisee_id == franchisee_id
        )
    claimed = select(FranchiseePincode.pincode).where(FranchiseePincode.company_id == company_id)
    return select(Pincode.code).where(Pincode.is_active.is_(True), Pincode.code.not_in(claimed))


async def lock_routing(db: AsyncSession, company_id: uuid.UUID, *, exclusive: bool) -> None:
    """The routing lock, one call: EXCLUSIVE for a caller about to WRITE the
    pincode map (Task 03's saves, the company deactivation), SHARED for the
    readers (Task 04's ticket pool routing) — so a pool read never lands between
    two halves of a carve-out. `pg_advisory_xact_lock` releases at COMMIT or
    ROLLBACK, so the caller keeps its transaction (this never commits), exactly
    the contract of `revoke_refresh_tokens` and `notify`.
    """
    fn = "pg_advisory_xact_lock" if exclusive else "pg_advisory_xact_lock_shared"
    await db.execute(
        text(f"select {fn}(hashtextextended(:key, 0))"),
        {"key": f"franchise-routing:{company_id}"},
    )


async def _franchisee_names(
    db: AsyncSession, company_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """One indexed read for every name a message will name. Missing/removed ids
    get no entry (`outside_message` falls back to an unnamed group)."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = await db.execute(
        select(Franchisee.id, Franchisee.name).where(
            Franchisee.company_id == company_id, Franchisee.id.in_(wanted)
        )
    )
    return dict(rows.all())


async def restamp_ticket(
    db: AsyncSession,
    row: Ticket,
    *,
    actor_kind: str,
    actor_label: str | None,
    by_user: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """Point `row.franchisee_id` at the CURRENT owner of `row.pincode`. Returns (old, new), or None
    when it already does.

    For a ticket being RE-ROUTED: released by its technician (cancel, confirmed no-show) or handed to a
    new one by a manager. A carve-out (Task 03) deliberately leaves assigned tickets where they were
    (F6); this is where they catch up, at the one moment the old stamp would otherwise strand them —
    offered to a franchisee whose technicians no longer cover the pincode.

    Takes lock_routing(shared). Writes in the caller's transaction:
      UPDATE tickets SET franchisee_id = :new WHERE company_id = :c AND id = :id AND franchisee_id = :old
    plus one TicketEvent(kind='franchisee_changed', from_status=None, to_status=None,
      note=f"{old_name} → {new_name} · pincode {pincode} belongs to {new_name}")
    and sets row.franchisee_id. Never commits.
    """
    await lock_routing(db, row.company_id, exclusive=False)
    owner = await franchisee_for_pincode(db, row.company_id, row.pincode)
    old = row.franchisee_id
    if not needs_restamp(old, owner):
        return None

    names = await _franchisee_names(db, row.company_id, (old, owner))
    old_name = names.get(old, "—")
    new_name = names.get(owner, "—")
    await db.execute(
        update(Ticket)
        .where(
            Ticket.company_id == row.company_id,
            Ticket.id == row.id,
            Ticket.franchisee_id == old,
        )
        .values(franchisee_id=owner)
    )
    db.add(
        TicketEvent(
            company_id=row.company_id,
            ticket_id=row.id,
            kind="franchisee_changed",
            actor_kind=actor_kind,
            actor_label=actor_label,
            note=f"{old_name} → {new_name} · pincode {row.pincode} belongs to {new_name}",
            from_status=None,
            to_status=None,
            created_by=by_user,
        )
    )
    row.franchisee_id = owner
    return old, owner


async def assert_pincodes_in_franchisee(
    db: AsyncSession,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    pincodes: Iterable[str],
    *,
    name_owners: bool,
) -> None:
    """Refuse coverage outside this franchisee (F4: the home owns every code no other franchisee owns).

    Takes lock_routing(shared) — a carve-out in flight is waited for, then judged after.
    routes = franchisees_for_pincodes(db, company_id, pincodes)          # Task 01, owner else home
    outside = codes_outside(pincodes, routes, franchisee_id)            # pure, franchise_routing
    if outside: raise AppError(422, "PINCODE_OUTSIDE_FRANCHISEE", outside_message(...))

    name_owners=True (staff): "Outside Acme Home: 500032, 500033 (SkyFix Services). Pick pincodes
      Acme Home owns."
    name_owners=False (a franchise principal, or the technician themselves at registration): "Outside
      your franchisee: 500032, 500033. Pick pincodes it owns." — one franchisee's admin is not told who
      owns another's codes.
    At most 20 codes then "and N more".

    Deliberately does NOT filter `is_active`: api/AGENTS.md "Exactly one read filters `is_active`" —
    editing a technician whose coverage predates a switch-off must still work. A switched-off code nobody
    owns routes to home, as it always did."""
    wanted = set(pincodes)
    if not wanted:
        return
    await lock_routing(db, company_id, exclusive=False)
    routes: Mapping[str, uuid.UUID] = await franchisees_for_pincodes(db, company_id, wanted)
    outside = codes_outside(wanted, routes, franchisee_id)
    if not outside:
        return
    names = await _franchisee_names(
        db, company_id, (franchisee_id, *(routes.get(p) for p in outside))
    )
    detail = outside_message(
        names.get(franchisee_id, "this franchisee"),
        outside,
        owner_names=names if name_owners else None,
    )
    raise AppError(422, "PINCODE_OUTSIDE_FRANCHISEE", detail)
