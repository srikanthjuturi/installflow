"""Spare parts — the shared half (Task 12).

In `core/` because three slices need it (jobs, spare_parts, tickets) and slices
never import each other (hard rule 4). The pure functions at the top are what
`tests/unit/test_spare_parts.py` pins; the DB helpers below them never commit —
the caller owns the transaction.

## The one rule that matters

A job is `Awaiting Part` EXACTLY while it has a request that is `requested` or
`approved` (D5). That is a fact about a SET of rows, so a single guarded UPDATE
cannot settle it: every writer that reads "which requests are open" and then
sets the ticket's status first takes `lock_ticket` — `FOR NO KEY UPDATE`, not
`FOR UPDATE`, because the latter conflicts with the `KEY SHARE` lock every FK
insert (`ticket_events`, `notifications`) takes on the ticket (the trap
`core/credits.py` documents for `companies`; D4).

Every move in or out of `Awaiting Part` is a `status_changed` event with both
`from_status` and `to_status` exact: that pair is the contract with Task 11's
`speed.clock_from_events`, which subtracts the wait from the speed clock. Change
neither side alone.
"""

import datetime
import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notifications import notify
from app.core.realtime import (
    publish_job_changed,
    publish_notification,
    publish_ticket_changed,
)
from app.models.membership import Membership
from app.models.product import ProductModel, ProductNode
from app.models.role import (
    ADMIN,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    FACILITY_ROLES,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
)
from app.models.spare_part import (
    OPEN_PART_REQUEST_STATUSES,
    SparePart,
    SparePartRequest,
)
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.models.user import User

#: Where a technician may raise a request (D1).
REQUESTABLE_STATUSES = ("In Progress", "Awaiting Part")

#: (current status, action) -> next status. P4 as amended by owner ruling
#: 2026-10-15 (R2: an approved request may be rejected, with a reason), D23.
TRANSITIONS: dict[tuple[str, str], str] = {
    ("requested", "approve"): "approved",
    ("requested", "reject"): "rejected",
    ("approved", "issue"): "issued",
    ("approved", "reject"): "rejected",      # owner ruling 2026-10-15 (R2)
    ("issued", "return"): "returned",
}
ACTIONS = ("approve", "reject", "issue", "return")


def next_status(current: str, action: str) -> str | None:
    """The status `action` moves a request to, or None when it may not."""
    return TRANSITIONS.get((current, action))


#: The order the console draws its buttons in: the step that moves the request
#: forward first, the refusal last (`approved -> [issue, reject]`).
_BUTTON_ORDER = ("approve", "issue", "return", "reject")


def allowed_actions(current: str) -> list[str]:
    """For the console's buttons — forward steps first, `reject` last."""
    return [a for a in _BUTTON_ORDER if next_status(current, a) is not None]


def job_status_after(current: str, request_statuses: Iterable[str]) -> str:
    """The ticket status once its requests are as given (D5).

    Only `In Progress` and `Awaiting Part` move; every other status is returned
    unchanged (a request settled after Complete or a force-closure moves nothing).
    Any open request -> `Awaiting Part`; none -> `In Progress`. A request rejected
    after approval (owner ruling 2026-10-15, R2) is `rejected` here like any other:
    no longer open, so the last one leaving returns the job to `In Progress`.
    """
    if current not in REQUESTABLE_STATUSES:
        return current
    if any(s in OPEN_PART_REQUEST_STATUSES for s in request_statuses):
        return "Awaiting Part"
    return "In Progress"


_SPACES = re.compile(r"\s+")


def normalize_part_name(value: str) -> str:
    """Trim and collapse inner whitespace; the stored display form. Case kept."""
    return _SPACES.sub(" ", value.strip())


def part_name_key(value: str) -> str:
    """`normalize_part_name(value).lower()` — mirrors SQL `lower(btrim(name))`
    (the partial uniques), plus the inner-space collapse the writers apply."""
    return normalize_part_name(value).lower()


@dataclass(frozen=True)
class CatalogueRow:
    id: uuid.UUID
    name: str
    is_active: bool
    #: 0 = root ... len(path)-1 = the ticket's node; len(path) = the model.
    level: int
    owner_kind: str          # 'node' | 'model'
    owner_id: uuid.UUID
    owner_name: str


def merge_catalogue(rows: Iterable[CatalogueRow]) -> list[CatalogueRow]:
    """D11: deepest row per `part_name_key` wins; then drop inactive; sort by
    (name key, level). An inactive deeper row therefore hides an inherited name."""
    best: dict[str, CatalogueRow] = {}
    for row in rows:
        key = part_name_key(row.name)
        held = best.get(key)
        if held is None or row.level > held.level:
            best[key] = row
    live = [r for r in best.values() if r.is_active]
    return sorted(live, key=lambda r: (part_name_key(r.name), r.level))


def can_create_facility_role(actor_role: str, target_role: str) -> bool:
    """Franchisee admin -> facility_admin | facility_operator; facility admin ->
    facility_operator; company admin / national head -> facility_admin |
    facility_operator (for the HOME franchisee only — the route enforces the
    franchisee, this function the roles; owner ruling 2026-10-15, R4); nobody
    else. The target must be a facility role: a franchisee admin is Task 03's."""
    if target_role not in FACILITY_ROLES:
        return False
    if actor_role in (ADMIN, NATIONAL_HEAD, FRANCHISEE_ADMIN):
        return True
    if actor_role == FACILITY_ADMIN:
        return target_role == FACILITY_OPERATOR
    return False


# ── database helpers (none commits) ───────────────────────────────────────────


async def lock_ticket(
    db: AsyncSession, company_id: uuid.UUID, ticket_id: uuid.UUID
) -> Ticket | None:
    """`SELECT … FROM tickets … FOR NO KEY UPDATE` (D4) — re-read under the lock.

    `populate_existing` because the caller usually loaded the row already; the
    lock is worthless if it then decides from a stale copy.
    """
    return await db.scalar(
        select(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == company_id,
            Ticket.deleted_at.is_(None),
        )
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


async def catalogue_for(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    node_path_ids: Iterable[uuid.UUID],
    model_id: uuid.UUID | None,
) -> list[CatalogueRow]:
    """What a ticket's technician may ask for: the merged, active list (D11).

    One query: `spare_parts` on any node in the path or on the model, joined to
    the owner's name. `node_path_ids` is an array PARAMETER here, so a plain
    membership test is right (the `IN (SELECT unnest(...))` trap in api/AGENTS.md
    applies only when the path is a subquery).
    """
    path = list(node_path_ids)
    level_of = {nid: i for i, nid in enumerate(path)}
    owner = []
    if path:
        owner.append(SparePart.node_id.in_(path))
    if model_id is not None:
        owner.append(SparePart.model_id == model_id)
    if not owner:
        return []
    rows = (
        await db.execute(
            select(
                SparePart.id,
                SparePart.name,
                SparePart.is_active,
                SparePart.node_id,
                SparePart.model_id,
                ProductNode.name,
                ProductModel.name,
            )
            .outerjoin(
                ProductNode,
                and_(
                    ProductNode.company_id == SparePart.company_id,
                    ProductNode.id == SparePart.node_id,
                ),
            )
            .outerjoin(
                ProductModel,
                and_(
                    ProductModel.company_id == SparePart.company_id,
                    ProductModel.id == SparePart.model_id,
                ),
            )
            .where(
                SparePart.company_id == company_id,
                SparePart.deleted_at.is_(None),
                or_(*owner),
            )
        )
    ).all()
    out: list[CatalogueRow] = []
    for pid, name, active, node_id, mid, node_name, model_name in rows:
        if node_id is not None:
            out.append(
                CatalogueRow(pid, name, active, level_of[node_id], "node", node_id, node_name or "")
            )
        else:
            out.append(
                CatalogueRow(pid, name, active, len(path), "model", mid, model_name or "")
            )
    return merge_catalogue(out)


async def requests_for_ticket(
    db: AsyncSession, *, company_id: uuid.UUID, ticket_id: uuid.UUID
) -> list[SparePartRequest]:
    """Oldest first — the job screen, the ticket page and the recompute."""
    return list(
        await db.scalars(
            select(SparePartRequest)
            .where(
                SparePartRequest.company_id == company_id,
                SparePartRequest.ticket_id == ticket_id,
            )
            .order_by(SparePartRequest.created_at.asc(), SparePartRequest.code.asc())
        )
    )


async def has_open_requests(
    db: AsyncSession, *, company_id: uuid.UUID, ticket_id: uuid.UUID
) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(
                    SparePartRequest.company_id == company_id,
                    SparePartRequest.ticket_id == ticket_id,
                    SparePartRequest.status.in_(OPEN_PART_REQUEST_STATUSES),
                )
            )
        )
    )


async def franchisee_has_facility(
    db: AsyncSession, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> bool:
    """Owner ruling 2026-10-15 (R4): at least one ACTIVE, non-deleted membership
    (active user too) of this franchisee whose role is `facility_admin` or
    `facility_operator`. A franchisee admin does NOT count — and neither does
    company staff, the home franchisee included. Asked about the TICKET's
    franchisee (D2)."""
    return bool(
        await db.scalar(
            select(
                exists().where(
                    Membership.company_id == company_id,
                    Membership.franchisee_id == franchisee_id,
                    Membership.is_active.is_(True),
                    Membership.deleted_at.is_(None),
                    Membership.user_id == User.id,
                    User.is_active.is_(True),
                    User.deleted_at.is_(None),
                    User.role.in_((FACILITY_ADMIN, FACILITY_OPERATOR)),
                )
            )
        )
    )


async def facility_franchisees(
    db: AsyncSession, company_id: uuid.UUID, franchisee_ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    """Batch twin of `franchisee_has_facility` — the franchisees among these
    that have a parts desk. One query, for list reads."""
    ids = set(franchisee_ids)
    if not ids:
        return set()
    rows = await db.scalars(
        select(Membership.franchisee_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == company_id,
            Membership.franchisee_id.in_(ids),
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            User.role.in_((FACILITY_ADMIN, FACILITY_OPERATOR)),
        )
        .distinct()
    )
    return set(rows)


async def settle_job_status(
    db: AsyncSession,
    ticket: Ticket,
    *,
    actor_kind: str,
    actor_label: str | None,
    by_user: uuid.UUID | None,
) -> str | None:
    """Recompute the job's status from its requests (D5). Returns the new status,
    or None when nothing moved. The caller holds `lock_ticket` and has FLUSHED
    any request it just wrote (hard rule 10: `autoflush=False`, so an unflushed
    first request is invisible here and the job would stay `In Progress`).

    A **guarded UPDATE** on the ticket's whole current shape (belt and braces
    under the lock) and a `status_changed` event with exact `from_status` /
    `to_status` — Task 11's speed clock reads those two words.
    """
    # Captured BEFORE the UPDATE: an ORM-enabled UPDATE synchronises the session,
    # and the event would record the ticket moving from the state it moved into.
    was = ticket.status
    held = ticket.technician_id
    statuses = list(
        await db.scalars(
            select(SparePartRequest.status).where(
                SparePartRequest.company_id == ticket.company_id,
                SparePartRequest.ticket_id == ticket.id,
            )
        )
    )
    to = job_status_after(was, statuses)
    if to == was:
        return None
    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket.id,
            Ticket.company_id == ticket.company_id,
            Ticket.technician_id.is_(None)
            if held is None
            else Ticket.technician_id == held,
            Ticket.status == was,
        )
        .values(status=to)
    )
    if result.rowcount == 0:
        return None
    ticket.status = to
    db.add(
        TicketEvent(
            company_id=ticket.company_id,
            ticket_id=ticket.id,
            kind="status_changed",
            actor_kind=actor_kind,
            actor_label=actor_label,
            created_by=by_user,
            from_status=was,
            to_status=to,
            note="Waiting for a spare part" if to == "Awaiting Part" else "Spare parts settled",
        )
    )
    await publish_ticket_changed(db, ticket)
    if held is not None:
        await publish_job_changed(
            db, company_id=ticket.company_id, technician_id=held, ticket_id=ticket.id
        )
    return to


async def notify_facility(
    db: AsyncSession,
    req: SparePartRequest,
    ticket: Ticket,
    *,
    technician_name: str,
) -> None:
    """Ring the franchisee's parts desk (D14). `to` is the franchise portal's
    request screen always — nobody in the staff shell handles parts (R4)."""
    row = await notify(
        db,
        company_id=req.company_id,
        kind="part_requested",
        title=f"{ticket.code}: spare part requested",
        detail=f"{req.part_name} · {technician_name} · {ticket.city} {ticket.pincode}",
        to=f"/franchise/parts/requests/{req.id}",
        ticket_id=ticket.id,
        pincode=ticket.pincode,
        audience="facility",
        franchisee_id=req.franchisee_id,
    )
    await publish_notification(
        db,
        company_id=req.company_id,
        pincode=ticket.pincode,
        audience="facility",
        franchisee_id=req.franchisee_id,
        notification_id=row.id,
    )


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)
