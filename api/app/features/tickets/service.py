"""Ticket service — intake and a territory-scoped list.

Three things here are worth reading before changing anything.

**Every id in a request body is an assertion, not a fact.** The vendor, the
subcategory, the model and their relationship to each other are all re-resolved
against `principal.company_id` before a row is written.

**The service type must be one the MODEL declares.** That is the payoff for
`product_models.service_types`: the master data governs intake, so nobody raises
a Tech Visit against a microwave that only supports installation.

**Visibility is by pincode**, not by the membership territory helper. See
`_visible` for why the existing `territory_scope` cannot be reused.
"""

import datetime
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import Select, case, func, or_, select
from sqlalchemy import false as sql_false
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.schemas import ListParams
from app.core.scope import ALL_INDIA_ROLES, own_scope
from app.core.service_types import SERVICE_TYPES
from app.core.tickets import (
    SLA_WARN_AT,
    TERMINAL_STATUSES,
    TICKET_STATUSES,
)
from app.db.repository import paginate
from app.features.tickets.schemas import (
    TicketCreateRequest,
    TicketDetailOut,
    TicketOut,
    TimelineEventOut,
)
from app.models.membership import Membership
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.role import AREA_MANAGER, REGIONAL_HEAD
from app.models.technician import TechnicianProfile
from app.models.territory import MembershipPincode
from app.models.ticket import Ticket
from app.models.user import User
from app.models.vendor import Vendor


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_404_NOT_FOUND, detail="Ticket not found"
    )


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=detail)


# ── SLA ───────────────────────────────────────────────────────────────────────


def sla_state(row: Ticket, *, now: datetime.datetime | None = None) -> str:
    """ok / warn / breach / done — derived, never stored.

    The service level says the slot must START within N hours of the ticket
    being raised, so:

      * a ticket with a slot is judged on that slot, once and for good;
      * a ticket WITHOUT one is judged on the clock, and goes late while the
        customer stays silent. That is the deliberate reading — see
        `app/core/tickets.py`.
    """
    if row.status in TERMINAL_STATUSES:
        return "done"

    now = now or _now()
    due = row.sla_due_at

    if row.slot_start is not None:
        return "breach" if row.slot_start > due else "ok"

    if now >= due:
        return "breach"

    window = (due - row.created_at).total_seconds()
    remaining = (due - now).total_seconds()
    if window > 0 and remaining / window <= SLA_WARN_AT:
        return "warn"
    return "ok"


def _sla_order_case():
    """Triage order in SQL, so paging and totals agree with what is rendered.

    Mirrors `sla_state`. It has to be expressed twice — once in Python for the
    value a row reports, once here for ordering — because sorting rows the
    database has not selected yet is not something Python can do.
    """
    now = _now()
    is_terminal = Ticket.status.in_(TERMINAL_STATUSES)
    has_slot = Ticket.slot_start.is_not(None)
    return case(
        (is_terminal, 3),
        (has_slot, case((Ticket.slot_start > Ticket.sla_due_at, 0), else_=2)),
        (Ticket.sla_due_at <= now, 0),
        (
            Ticket.sla_due_at
            <= now
            + (Ticket.sla_due_at - Ticket.created_at) * SLA_WARN_AT,
            1,
        ),
        else_=2,
    )


# ── visibility ────────────────────────────────────────────────────────────────


async def _visible_pincodes(
    db: AsyncSession, principal: Principal
) -> list[str] | None:
    """The pincodes this caller may see tickets in. `None` means "all".

    Deliberately NOT `db.repository.territory_scope`. That helper filters a
    MEMBERSHIP query, and its regional branch goes through `membership_regions`
    — but a ticket has no membership and no region, only a pincode, and there is
    no pincode → region master anywhere in the system to bridge the two.

    So a Regional Head's reach is defined as the pincodes their Area Managers
    cover. That is the honest reading of "their region" with the data we have;
    if RH should see by region proper, a pincode → region table has to exist
    first.
    """
    if principal.role in ALL_INDIA_ROLES:
        return None

    membership_id, scope = await own_scope(
        db, user_id=principal.user_id, company_id=principal.company_id
    )
    if membership_id is None:
        return []

    if principal.role == AREA_MANAGER:
        return list(scope.pincodes)

    if principal.role == REGIONAL_HEAD:
        reports = await db.scalars(
            select(MembershipPincode.pincode)
            .join(Membership, Membership.id == MembershipPincode.membership_id)
            .where(
                Membership.company_id == principal.company_id,
                Membership.manager_id == membership_id,
                Membership.deleted_at.is_(None),
            )
        )
        return list({*reports, *scope.pincodes})

    # Any other role sees nothing rather than everything.
    return []


def _apply_visibility(stmt: Select, pincodes: list[str] | None) -> Select:
    if pincodes is None:
        return stmt
    if not pincodes:
        # Covers nothing, so sees nothing — fail closed. `sql_false()`, not
        # `func.false()`: the latter renders as `false()`, which Postgres
        # rejects as a call to a function that does not exist.
        return stmt.where(sql_false())
    return stmt.where(Ticket.pincode.in_(pincodes))


# ── loaders and validation ────────────────────────────────────────────────────


async def _load(
    db: AsyncSession, principal: Principal, ticket_id: uuid.UUID
) -> Ticket:
    stmt = select(Ticket).where(
        Ticket.id == ticket_id,
        Ticket.company_id == principal.company_id,
        Ticket.deleted_at.is_(None),
    )
    stmt = _apply_visibility(stmt, await _visible_pincodes(db, principal))
    row = await db.scalar(stmt)
    if row is None:
        # Applied to fetch-by-id too, so guessing an id outside your territory
        # reads as 404 — a 403 would confirm the ticket exists.
        raise _not_found()
    return row


async def _resolve_product(
    db: AsyncSession, principal: Principal, body: TicketCreateRequest
) -> tuple[Vendor, ProductSubcategory, ProductModel]:
    company_id = principal.company_id

    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.id == body.vendorId,
            Vendor.company_id == company_id,
            Vendor.is_active.is_(True),
            Vendor.deleted_at.is_(None),
        )
    )
    if vendor is None:
        raise _bad_request("Unknown or inactive vendor")

    subcategory = await db.scalar(
        select(ProductSubcategory).where(
            ProductSubcategory.id == body.subcategoryId,
            ProductSubcategory.company_id == company_id,
            ProductSubcategory.is_active.is_(True),
            ProductSubcategory.deleted_at.is_(None),
        )
    )
    if subcategory is None:
        raise _bad_request("Unknown or inactive category")

    model = await db.scalar(
        select(ProductModel).where(
            ProductModel.id == body.modelId,
            ProductModel.company_id == company_id,
            ProductModel.is_active.is_(True),
            ProductModel.deleted_at.is_(None),
        )
    )
    if model is None:
        raise _bad_request("Unknown or inactive product model")

    # The pair has to agree, or a ticket says "Television" and names a
    # microwave. Both ids came from the same request and neither vouches for
    # the other.
    if model.subcategory_id != subcategory.id:
        raise _bad_request(
            f"{model.name} is not a {subcategory.name} — pick a model from the "
            "chosen category"
        )

    supported = list(model.service_types or [])
    if body.serviceType not in supported:
        raise _bad_request(
            f"{model.name} does not support {body.serviceType}. "
            f"It supports {', '.join(supported) or 'nothing yet'}."
        )

    return vendor, subcategory, model


async def next_code(db: AsyncSession, company_id: uuid.UUID) -> str:
    """`INST-240912`. The unique on (company_id, code) settles a race as a 409.

    Same counter approach as `technicians.next_code`. NB the prefix is `INST-`
    for every service type, including Tech Visit and Service — that is what the
    prototype and the mobile app both use, and changing it is a decision about
    what people read on a phone call, not a technical one.
    """
    used = await db.scalar(
        select(func.count(Ticket.id)).where(Ticket.company_id == company_id)
    )
    return f"INST-{240912 + int(used or 0)}"


# ── hydration ─────────────────────────────────────────────────────────────────


async def _hydrate(db: AsyncSession, rows: list[Ticket]) -> list[TicketOut]:
    """Resolve names for a page of tickets — one query per relation, never N+1."""
    if not rows:
        return []

    vendor_names = {
        r[0]: r[1]
        for r in await db.execute(
            select(Vendor.id, Vendor.name).where(
                Vendor.id.in_({t.vendor_id for t in rows})
            )
        )
    }
    model_names = {
        r[0]: r[1]
        for r in await db.execute(
            select(ProductModel.id, ProductModel.name).where(
                ProductModel.id.in_({t.model_id for t in rows})
            )
        )
    }
    # Subcategory carries its parent's name too, because the console groups the
    # category column by it.
    sub_rows = await db.execute(
        select(ProductSubcategory.id, ProductSubcategory.name, ProductCategory.name)
        .join(ProductCategory, ProductCategory.id == ProductSubcategory.category_id)
        .where(ProductSubcategory.id.in_({t.subcategory_id for t in rows}))
    )
    subs = {r[0]: (r[1], r[2]) for r in sub_rows}

    # A technician's name is not on their profile — it is on the User the
    # membership points at, so this is a two-hop join rather than a lookup.
    tech_ids = {t.technician_id for t in rows if t.technician_id}
    tech_names = (
        {
            r[0]: r[1]
            for r in await db.execute(
                select(TechnicianProfile.id, User.full_name)
                .join(Membership, Membership.id == TechnicianProfile.membership_id)
                .join(User, User.id == Membership.user_id)
                .where(TechnicianProfile.id.in_(tech_ids))
            )
        }
        if tech_ids
        else {}
    )

    now = _now()
    out: list[TicketOut] = []
    for t in rows:
        sub_name, cat_name = subs.get(t.subcategory_id, ("", ""))
        out.append(
            TicketOut(
                id=t.id,
                code=t.code,
                vendorId=t.vendor_id,
                vendorName=vendor_names.get(t.vendor_id, ""),
                subcategoryId=t.subcategory_id,
                categoryName=cat_name,
                subcategoryName=sub_name,
                modelId=t.model_id,
                modelName=model_names.get(t.model_id, ""),
                serviceType=t.service_type,
                description=t.description,
                serialNumber=t.serial_number,
                customerName=t.customer_name,
                customerPhone=t.customer_phone,
                address=t.address,
                city=t.city,
                state=t.state,
                pincode=t.pincode,
                expectedDate=t.expected_date,
                serviceLevelHours=t.service_level_hours,
                slotStart=t.slot_start,
                slotEnd=t.slot_end,
                slaDueAt=t.sla_due_at,
                slaState=sla_state(t, now=now),
                status=t.status,
                technicianId=t.technician_id,
                technicianName=tech_names.get(t.technician_id)
                if t.technician_id
                else None,
                createdAt=t.created_at,
            )
        )
    return out


# ── read ──────────────────────────────────────────────────────────────────────


def _apply_search(stmt: Select, search: str | None) -> Select:
    if not search:
        return stmt
    term = f"%{search.strip().lower()}%"
    return stmt.where(
        or_(
            func.lower(Ticket.code).like(term),
            func.lower(Ticket.customer_name).like(term),
            func.lower(Ticket.customer_phone).like(term),
            Ticket.pincode.like(term),
        )
    )


#: The console's "no filter" sentinel. Its filter pills are a closed set with
#: "All" at the front, and that value rides into the query string like any
#: other, so the API has to understand it means "do not filter" rather than
#: "match a status literally named All" — which would silently return nothing.
ALL_SENTINEL = "all"


def _canonical(value: str | None, allowed: tuple[str, ...]) -> str | None | bool:
    """Match a filter value case-insensitively against a closed set.

    Three outcomes, and the caller has to tell them apart:

        None   no filter asked for (absent, blank, or the "All" sentinel)
        str    the canonical spelling to filter on
        False  asked for something that does not exist

    Filters arrive from a shareable query string, so an older bookmark must not
    be able to 422 the whole list; an unknown value yields an empty page.
    """
    if not value:
        return None
    wanted = value.strip().lower()
    if wanted == ALL_SENTINEL:
        return None
    return next((a for a in allowed if a.lower() == wanted), False)


async def list_tickets(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    status_filter: str | None = None,
    sla_filter: str | None = None,
    service_type: str | None = None,
) -> tuple[list[TicketOut], int]:
    stmt = select(Ticket).where(
        Ticket.company_id == principal.company_id,
        Ticket.deleted_at.is_(None),
    )
    stmt = _apply_visibility(stmt, await _visible_pincodes(db, principal))
    stmt = _apply_search(stmt, params.search)

    wanted = _canonical(status_filter, TICKET_STATUSES)
    if wanted is False:
        return [], 0
    if wanted:
        stmt = stmt.where(Ticket.status == wanted)

    wanted = _canonical(service_type, SERVICE_TYPES)
    if wanted is False:
        return [], 0
    if wanted:
        stmt = stmt.where(Ticket.service_type == wanted)

    wanted = _canonical(sla_filter, ("ok", "warn", "breach", "done"))
    if wanted is False:
        return [], 0
    if wanted:
        rank = {"breach": 0, "warn": 1, "ok": 2, "done": 3}[str(wanted)]
        stmt = stmt.where(_sla_order_case() == rank)

    # Default: most urgent first, which is the whole point of the screen.
    if params.sortBy == "createdAt":
        column = Ticket.created_at
        stmt = stmt.order_by(
            column.asc() if params.sortDir == "asc" else column.desc()
        )
    else:
        stmt = stmt.order_by(_sla_order_case().asc(), Ticket.created_at.desc())

    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await _hydrate(db, rows), total


async def get_ticket(
    db: AsyncSession, principal: Principal, ticket_id: uuid.UUID
) -> TicketDetailOut:
    row = await _load(db, principal, ticket_id)
    base = (await _hydrate(db, [row]))[0]
    return TicketDetailOut(**base.model_dump(), timeline=_timeline(row))


def _timeline(row: Ticket) -> list[TimelineEventOut]:
    """The audit trail, built ONLY from stored facts.

    Short on purpose. The mock derived seven events from `status` alone —
    including "Notified 6 eligible technicians" for a ticket nothing had
    notified — and a fabricated audit trail is worse than a thin one, because
    people believe it. Events arrive here as the slices that cause them land.
    """
    events = [
        TimelineEventOut(
            at=row.created_at,
            kind="intake",
            title="Ticket created",
            by="Manual entry",
            note=(
                f"{row.service_type} · {row.service_level_hours}h service level · "
                f"{row.city} {row.pincode}"
            ),
        )
    ]
    if row.slot_start is not None:
        events.append(
            TimelineEventOut(
                at=row.created_at,
                kind="lock",
                title="Slot confirmed & locked",
                by=row.customer_name,
                note=row.slot_start.strftime("%d %b %Y, %H:%M"),
            )
        )
    return events


# ── write ─────────────────────────────────────────────────────────────────────


async def create_ticket(
    db: AsyncSession, principal: Principal, body: TicketCreateRequest
) -> TicketOut:
    vendor, subcategory, model = await _resolve_product(db, principal, body)

    now = _now()
    row = Ticket(
        company_id=principal.company_id,
        code=await next_code(db, principal.company_id),
        vendor_id=vendor.id,
        subcategory_id=subcategory.id,
        model_id=model.id,
        service_type=body.serviceType,
        description=body.description,
        serial_number=(body.serialNumber or "").strip() or None,
        customer_name=body.customerName.strip(),
        customer_phone=body.customerPhone,
        address=body.address,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        expected_date=body.expectedDate,
        service_level_hours=body.serviceLevelHours,
        slot_start=body.slotStart,
        slot_end=body.slotEnd,
        sla_due_at=now + datetime.timedelta(hours=body.serviceLevelHours),
        # A slot means the customer has agreed a time, so the ticket is ready
        # for technicians to see. Without one nobody is told it exists yet.
        status="New" if body.slotStart else "Slot Pending",
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return (await _hydrate(db, [row]))[0]
