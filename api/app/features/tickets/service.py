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
import secrets
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import Select, case, func, or_, select
from sqlalchemy import false as sql_false
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import Principal
from app.core.schemas import ListParams
from app.core.scope import ALL_INDIA_ROLES, own_scope
from app.core.sequences import next_code as allocate_code
from app.core.service_types import SERVICE_TYPES
from app.core.tickets import (
    SLA_WARN_AT,
    SLOT_LEAD_MINUTES,
    SLOT_TIMEZONE_OFFSET_MINUTES,
    SLOT_WINDOWS,
    TERMINAL_STATUSES,
    TICKET_STATUSES,
)
from app.db.repository import paginate
from app.integrations import whatsapp
from app.features.tickets.schemas import (
    TicketCreateRequest,
    TicketDetailOut,
    TicketOut,
    TimelineEventOut,
)
from app.models.company import Company
from app.models.membership import Membership
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.role import AREA_MANAGER, REGIONAL_HEAD, VENDOR_USER
from app.models.technician import TechnicianProfile
from app.models.territory import MembershipPincode
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
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


# ── the windows a customer may pick from ─────────────────────────────────────

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))


def offered_slots(
    row: Ticket, *, now: datetime.datetime | None = None
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """Every window this ticket could still be served in, soonest first.

    Bounded at both ends, and both bounds matter:

      * not sooner than SLOT_LEAD_MINUTES from now — nobody can be dispatched to
        an address in ten minutes;
      * not later than `sla_due_at` — the service level says the slot must START
        within N hours of the ticket being raised, so a window past that is one
        the company has already promised not to offer.

    Because the list is generated from the window rather than filtered
    afterwards, a customer CANNOT pick a slot that breaches. That is the point:
    the constraint lives where the choice is made, not in a validator that has
    to say no to something already chosen.

    Empty is a real answer — a 12-hour ticket raised at 22:00 has nothing left
    to offer, and the page says so rather than showing an empty list.
    """
    now = now or _now()
    earliest = now + datetime.timedelta(minutes=SLOT_LEAD_MINUTES)
    latest = row.sla_due_at

    out: list[tuple[datetime.datetime, datetime.datetime]] = []
    # Walk local days, because the windows are local working hours. Three is
    # enough for the longest service level (48h) plus the day it spills into.
    start_day = earliest.astimezone(IST).date()
    for offset in range(4):
        day = start_day + datetime.timedelta(days=offset)
        for from_hour, to_hour in SLOT_WINDOWS:
            begins = datetime.datetime.combine(
                day, datetime.time(from_hour, tzinfo=IST)
            )
            ends = datetime.datetime.combine(day, datetime.time(to_hour, tzinfo=IST))
            if begins < earliest or begins > latest:
                continue
            out.append((begins, ends))
    return out


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


async def scoped(db: AsyncSession, stmt: Select, principal: Principal) -> Select:
    """Narrow a ticket query to what this caller may see.

    Two entirely different rules, because staff and vendors look at the work
    from opposite ends:

    * **Staff** see by GEOGRAPHY — their territory's pincodes, or everything for
      an all-India role.
    * **A vendor** sees by OWNERSHIP — the tickets raised against it, whoever in
      the vendor typed them. A **vendor user** sees only the ones they raised
      themselves.

    Always in addition to the `company_id` filter the caller has already
    applied, never instead of it. And always applied to fetch-by-id too, so a
    guessed id from another vendor reads 404 rather than a 403 that would
    confirm the ticket exists.
    """
    if principal.is_vendor:
        if principal.vendor_id is None:
            # A portal role whose membership names no vendor. Should not exist —
            # both creation paths set it — so this is a corrupt row, not a
            # permission question. Show nothing rather than everything.
            return stmt.where(sql_false())
        stmt = stmt.where(Ticket.vendor_id == principal.vendor_id)
        if principal.role == VENDOR_USER:
            stmt = stmt.where(Ticket.created_by == principal.user_id)
        return stmt

    return _apply_visibility(stmt, await _visible_pincodes(db, principal))


# ── loaders and validation ────────────────────────────────────────────────────


async def _load(
    db: AsyncSession, principal: Principal, ticket_id: uuid.UUID
) -> Ticket:
    stmt = select(Ticket).where(
        Ticket.id == ticket_id,
        Ticket.company_id == principal.company_id,
        Ticket.deleted_at.is_(None),
    )
    stmt = await scoped(db, stmt, principal)
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

    # The caller's OWN vendor, from the principal — never from the body. A
    # vendor does not choose which vendor it is, and a request that could name
    # one would let vendor A write a ticket into vendor B's book.
    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.id == principal.vendor_id,
            Vendor.company_id == company_id,
            Vendor.is_active.is_(True),
            Vendor.deleted_at.is_(None),
        )
    )
    if vendor is None:
        # Removed or paused out from under a live session. Say which, because
        # "unknown vendor" is incomprehensible to someone who IS that vendor.
        raise _bad_request(
            "Your vendor account is paused. Ask the team who set it up to "
            "reactivate it before raising tickets."
        )

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

    # And the model has to be the caller's OWN brand. The composite FK cannot
    # say this — it constrains `(company_id, vendor_id)`, not `(vendor, model)`
    # — so without this check a vendor could enumerate a competitor's models
    # through the category tree and raise tickets branded to them.
    if model.vendor_id != vendor.id:
        raise _bad_request(
            f"{model.name} is not one of your models — pick one of your own"
        )

    supported = list(model.service_types or [])
    if body.serviceType not in supported:
        raise _bad_request(
            f"{model.name} does not support {body.serviceType}. "
            f"It supports {', '.join(supported) or 'nothing yet'}."
        )

    return vendor, subcategory, model


async def next_code(db: AsyncSession, company_id: uuid.UUID) -> str:
    """`INST-240912`, from the company's counter row.

    This used to be `240912 + COUNT(*)`, which raced: two creators reading the
    same count produce the same code and one of them gets a 409. Bulk upload
    would have made that the normal case rather than the rare one — a batch
    computes the same COUNT for every row in it, because none are committed yet.
    See `app.core.sequences`.

    NB the prefix is `INST-` for every service type, including Tech Visit and
    Service — that is what the prototype and the mobile app both use, and
    changing it is a decision about what people read on a phone call, not a
    technical one.
    """
    return await allocate_code(db, company_id, "ticket")


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
                slotRequestStatus=t.slot_request_status,
                slotRequestError=t.slot_request_error,
                slotConfirmedAt=t.slot_confirmed_at,
                # Only while it is still the customer's to pick. Once used the
                # token is spent, and a link that does nothing is worse than
                # none at all.
                slotLink=(
                    slot_link(t.slot_token)
                    if t.slot_token and t.slot_confirmed_at is None
                    else None
                ),
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
    stmt = await scoped(db, stmt, principal)
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
    return TicketDetailOut(
        **base.model_dump(), timeline=await _timeline(db, row)
    )


#: How a stored event kind reads on the timeline. The stored row keeps the fact;
#: this keeps the wording, so rephrasing a title never means rewriting history.
_EVENT_TITLES = {
    "created": "Ticket created",
    "slot_requested": "Slot request sent",
    "slot_confirmed": "Slot confirmed & locked",
    "confirmation_sent": "Confirmation sent",
    "status_changed": "Status changed",
}


async def _timeline(db: AsyncSession, row: Ticket) -> list[TimelineEventOut]:
    """The audit trail, read from `ticket_events` — oldest first.

    It used to be DERIVED from the ticket's current columns, which capped it at
    two entries and could never say when anything happened: a status column
    keeps no history. The mock version of the same idea invented "Notified 6
    eligible technicians" for a ticket nothing had notified, and a fabricated
    trail is worse than a thin one because people believe it.

    Still only as long as what actually happened. Rows appear as the slices that
    cause them land.
    """
    events = await db.scalars(
        select(TicketEvent)
        .where(
            TicketEvent.company_id == row.company_id,
            TicketEvent.ticket_id == row.id,
        )
        # `seq`, never `created_at` — see the column's note: events written in
        # one transaction share a timestamp.
        .order_by(TicketEvent.seq)
    )
    return [
        TimelineEventOut(
            at=e.created_at,
            kind=e.kind,
            title=_EVENT_TITLES.get(e.kind, e.kind),
            by=e.actor_label,
            note=e.note,
        )
        for e in events
    ]


def record_event(
    row: Ticket,
    kind: str,
    *,
    actor_kind: str,
    actor_label: str | None = None,
    note: str | None = None,
    from_status: str | None = None,
    to_status: str | None = None,
    by_user: uuid.UUID | None = None,
) -> TicketEvent:
    """Build the event for something that just happened to `row`.

    Returns it rather than adding it, so the caller decides which transaction it
    belongs to — an event must commit with the change it describes, never
    separately, or a crash between the two leaves a trail that disagrees with
    the ticket.
    """
    return TicketEvent(
        company_id=row.company_id,
        ticket_id=row.id,
        kind=kind,
        actor_kind=actor_kind,
        actor_label=actor_label,
        note=note,
        from_status=from_status,
        to_status=to_status,
        created_by=by_user,
    )


# ── the customer's slot confirmation ─────────────────────────────────────────


def slot_link(token: str) -> str:
    return f"{settings.SLOT_LINK_BASE.rstrip('/')}/{token}"


def when_label(start: datetime.datetime, end: datetime.datetime) -> str:
    """`Thu 21 Aug, 10:00–12:00`, in the customer's own timezone."""
    local_start = start.astimezone(IST)
    local_end = end.astimezone(IST)
    return (
        f"{local_start.strftime('%a %d %b')}, "
        f"{local_start.strftime('%H:%M')}–{local_end.strftime('%H:%M')}"
    )


async def _company_name(db: AsyncSession, company_id: uuid.UUID) -> str:
    # Resolved from the row rather than a constant: one WhatsApp number sends
    # for every tenant on this platform.
    return (
        await db.scalar(select(Company.name).where(Company.id == company_id))
    ) or "Videocon Service"


async def _send_slot_request(db: AsyncSession, row: Ticket) -> None:
    """Ask the customer to pick a time. Records the outcome, never raises.

    A refusal is not an error for the caller: the ticket exists and the link is
    still valid, so ops can copy it out of the console or read the options down
    the phone. Raising here would lose a row over a message.
    """
    model_name = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    result = await whatsapp.send_slot_request(
        row.customer_phone,
        slot_link(row.slot_token or ""),
        await _company_name(db, row.company_id),
        model_name or "product",
    )
    if result.ok:
        # Meta ACCEPTED it. Not the same as delivered — without a webhook an
        # asynchronous drop (131047) is invisible.
        row.slot_request_status = "sent"
        row.slot_request_error = None
    else:
        row.slot_request_status = "failed"
        row.slot_request_error = (result.error or "")[:255]


async def _send_slot_confirmed(db: AsyncSession, row: Ticket) -> TicketEvent | None:
    """The receipt. Sent on BOTH routes — ops-entered and customer-picked —
    because from the customer's side they are the same event, and only one of
    them otherwise leaves them anything in writing. Never raises.

    Returns the event recording the OUTCOME, for the caller to add.

    It used to return nothing and discard the result. So when a customer did not
    get their confirmation there was no record anywhere that we had even tried,
    let alone what Meta said — the ticket showed a booked slot and total silence
    about the message. `slot_request_status` does not cover this: that column is
    about the request to PICK a time, and reads `not_needed` on exactly the
    route that sends this one.
    """
    if row.slot_start is None or row.slot_end is None:
        return None
    model_name = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    result = await whatsapp.send_slot_confirmed(
        row.customer_phone,
        await _company_name(db, row.company_id),
        model_name or "your product",
        when_label(row.slot_start, row.slot_end),
    )
    return record_event(
        row,
        "confirmation_sent",
        actor_kind="system",
        actor_label="WhatsApp",
        # Meta's own words when it refused. "Accepted" is not "delivered" —
        # without a webhook an asynchronous drop stays invisible either way,
        # but a synchronous refusal no longer does.
        note=(
            f"Confirmation sent to {row.customer_phone}"
            if result.ok
            else f"Could not send: {result.error or 'unknown error'}"
        ),
    )


async def load_by_token(db: AsyncSession, token: str) -> Ticket:
    """Resolve a slot token. No company scope — the token IS the identity.

    Deliberately the only place in the codebase that reads a ticket without a
    principal. It is safe because the token is 256 bits, single-use, and the
    endpoints above it never reveal anything beyond the one appointment it
    names.
    """
    row = await db.scalar(
        select(Ticket).where(
            Ticket.slot_token == token, Ticket.deleted_at.is_(None)
        )
    )
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="This link is not valid",
        )
    return row


async def confirm_slot(
    db: AsyncSession, token: str, start: datetime.datetime
) -> Ticket:
    """Lock the slot the customer picked, and let technicians see the ticket.

    The chosen start must be one of the windows still on offer, recomputed here
    rather than trusted from the request — the page was rendered at some point
    in the past, and a window that was open then may have passed since.
    """
    row = await load_by_token(db, token)

    if row.slot_confirmed_at is not None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="This time has already been confirmed",
        )
    if row.status in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="This visit is no longer open",
        )

    match = next((s for s in offered_slots(row) if s[0] == start), None)
    if match is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="That time is no longer available — please pick another",
        )

    was = row.status
    row.slot_start, row.slot_end = match
    row.slot_confirmed_at = _now()
    # Slot Pending was the only thing holding it back. It is now a real
    # appointment, and eligible technicians can see it.
    row.status = "New"
    # The customer has no user row, which is exactly why the event records an
    # actor KIND as well as a label — `created_by` cannot answer this one.
    db.add(
        record_event(
            row,
            "slot_confirmed",
            actor_kind="customer",
            actor_label=row.customer_name,
            note=when_label(*match),
            from_status=was,
            to_status=row.status,
        )
    )
    await db.commit()
    await db.refresh(row)

    sent = await _send_slot_confirmed(db, row)
    if sent is not None:
        db.add(sent)
        await db.commit()
    return row


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
        # Only a ticket that still has to ask carries a token. 256 bits, the
        # same as a technician invite, because it is the same kind of secret:
        # a URL somebody is trusted to hold.
        slot_token=None if body.slotStart else secrets.token_urlsafe(32),
        slot_request_status="not_needed" if body.slotStart else "pending",
        # Only value written today; see the column's note on why it is recorded
        # from the start rather than added when bulk upload lands.
        # Manual Entry is the only channel that exists; the importer will write
        # 'Excel' from its own path. Recorded rather than assumed, which is the
        # column's whole reason for existing.
        source="Manual",
        created_by=principal.user_id,
    )
    db.add(row)
    # autoflush is OFF (hard rule 8) and the event needs the ticket's id.
    await db.flush()

    # The vendor's own name, not the person's: a sub-user leaves, the ticket
    # stays, and "who raised this" should still answer with the party that is
    # accountable for it. `created_by` keeps the individual.
    actor = vendor.name
    db.add(
        record_event(
            row,
            "created",
            actor_kind="vendor",
            actor_label=actor,
            note=(
                f"{row.service_type} · {row.service_level_hours}h service level · "
                f"{row.city} {row.pincode}"
            ),
            to_status=row.status,
            by_user=principal.user_id,
        )
    )
    if row.slot_start is not None:
        # Ops typed the time in, so there was never anything to ask the
        # customer. The event still records it: "who agreed this slot" is a
        # question the cancellation bands will need an answer to.
        db.add(
            record_event(
                row,
                "slot_confirmed",
                actor_kind="vendor",
                actor_label=actor,
                note=when_label(row.slot_start, row.slot_end),
                to_status=row.status,
                by_user=principal.user_id,
            )
        )
    await db.commit()
    await db.refresh(row)

    # Both branches tell the customer something, and neither can fail the
    # request: the ticket is saved before either is attempted, and a refusal is
    # recorded rather than raised.
    if row.slot_start is not None:
        sent = await _send_slot_confirmed(db, row)
        if sent is not None:
            db.add(sent)
            await db.commit()
    else:
        await _send_slot_request(db, row)
        db.add(
            record_event(
                row,
                "slot_requested",
                actor_kind="system",
                actor_label="WhatsApp",
                # Meta's own words when it refused, so the trail says WHY a
                # customer never got the link rather than only that one was due.
                note=(
                    f"Slot link sent to {row.customer_phone}"
                    if row.slot_request_status == "sent"
                    else f"Could not send: {row.slot_request_error or 'unknown error'}"
                ),
            )
        )
        await db.commit()

    return (await _hydrate(db, [row]))[0]
