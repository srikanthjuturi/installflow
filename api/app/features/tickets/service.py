"""Ticket service — intake and a territory-scoped list.

Three things here are worth reading before changing anything.

**Every id in a request body is an assertion, not a fact.** The vendor, the
subcategory, the model and their relationship to each other are all re-resolved
against `principal.company_id` before a row is written.

**The service type must be one the MODEL declares.** That is the payoff for
`product_models.service_types`: the master data governs intake, so nobody raises
a Tech Visit against a microwave that only supports installation.

**Visibility is by pincode**, not by the membership territory helper — a ticket
has no membership, only a pincode. Since the geography master landed those
pincodes resolve to a state and a region, so a regional head now sees his whole
region rather than an approximation of it. See `_visible_pincodes`.
"""

import datetime
import secrets
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import Select, case, func, or_, select, update
from sqlalchemy import false as sql_false
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.coverage import has_cap_room, ist_day_bounds, technicians_covering
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.ledger import (
    cap_remaining,
    charged_this_month,
    entry as ledger_entry,
)
from app.core.push import announce_pool_job, send_to_technician
from app.core.realtime import (
    publish_job_changed,
    publish_pool_changed,
    publish_ticket_changed,
)
from app.core.schemas import ListParams
from app.core.scope import (
    pincodes_in_regions,
    pincodes_in_states,
    visible_pincodes,
)
from app.core.sequences import next_code as allocate_code
from app.features.tickets.feedback_service import refresh_technician_stats
from app.core.service_types import SERVICE_TYPES
from app.core.rules import CANCEL_PENALTY_BANDS, load_rules
from app.core.tickets import (
    SLOT_LEAD_MINUTES,
    SLOT_TIMEZONE_OFFSET_MINUTES,
    SLOT_WINDOWS,
    TERMINAL_STATUSES,
    TICKET_STATUSES,
)
from app.db.repository import paginate
from app.integrations import blob, whatsapp
from app.features.tickets.schemas import (
    AttentionOut,
    DashboardSummaryOut,
    ForceCloseRequest,
    FunnelOut,
    RenotifyOut,
    SlaBreakdownOut,
    TicketAttachmentOut,
    TicketCreateRequest,
    TicketDetailOut,
    TicketOut,
    TicketProofOut,
    TimelineEventOut,
)
from app.models.company import Company
from app.models.membership import Membership
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.role import AREA_MANAGER, REGIONAL_HEAD, VENDOR_USER
from app.models.technician import (
    ACTIVE,
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.ticket import Ticket, TicketAttachment, TicketProof
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


def sla_state(
    row: Ticket, *, warn_at_pct: int, now: datetime.datetime | None = None
) -> str:
    """ok / warn / breach / done — derived, never stored.

    The service level says the slot must START within N hours of the ticket
    being raised, so:

      * a ticket with a slot is judged on that slot, once and for good;
      * a ticket WITHOUT one is judged on the clock, and goes late while the
        customer stays silent. That is the deliberate reading — see
        `app/core/tickets.py`.

    `warn_at_pct` is the ticket's own company's rule and is passed in rather
    than read here: this is called once per row of a page, and a lookup inside
    would be the same query a hundred times.
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
    if window > 0 and remaining / window <= warn_at_pct / 100:
        return "warn"
    return "ok"


def _sla_order_case(warn_at_pct: int):
    """Triage order in SQL, so paging and totals agree with what is rendered.

    Mirrors `sla_state`. It has to be expressed twice — once in Python for the
    value a row reports, once here for ordering — because sorting rows the
    database has not selected yet is not something Python can do.

    A scalar rather than a join onto `company_rules`: every caller is already
    scoped to one company, so there is exactly one value and folding it in keeps
    this an expression the caller can also filter on.
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
            + (Ticket.sla_due_at - Ticket.created_at) * (warn_at_pct / 100),
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


def check_slot_bookable(row: Ticket, *, now: datetime.datetime) -> None:
    """A slot typed at intake must be one the customer could have picked.

    ONE rule rather than four. "In the future", "far enough ahead to dispatch",
    "a real working window" and "inside the service level" are all already
    expressed, once, by `offered_slots` — re-stating them here as separate
    guards would be four chances to drift from the list the customer is shown.

    This closes the hole that let a ticket be born breached: `offered_slots`
    never offers a window past `sla_due_at`, but nothing stopped a vendor from
    typing one straight into the create request, and `sla_state` then reported
    the breach the moment the row existed.

    No-op when there is no slot — that ticket is Slot Pending and the customer
    picks from this same list.
    """
    if row.slot_start is None or row.slot_end is None:
        return

    available = offered_slots(row, now=now)
    if not available:
        raise _bad_request(
            f"A {row.service_level_hours}h service level leaves no bookable "
            "window — every one of them is already past the deadline. Choose a "
            "longer service level, or leave the slot blank and the customer "
            "will be asked to pick."
        )
    if (row.slot_start, row.slot_end) not in available:
        # The first few, not all twenty: enough to show the shape of what is
        # allowed without turning a validation message into a timetable.
        shown = ", ".join(when_label(*s) for s in available[:3])
        more = "" if len(available) <= 3 else f", and {len(available) - 3} more"
        raise _bad_request(
            "That is not a time this ticket can be served in. A slot has to be "
            f"one of the two-hour windows inside the {row.service_level_hours}h "
            f"service level — {shown}{more}."
        )


# ── visibility ────────────────────────────────────────────────────────────────


async def _visible_pincodes(
    db: AsyncSession, principal: Principal
) -> Select | None | list:
    """Delegates to `core.scope.visible_pincodes`.

    Kept as a name because this module reads better for it, but the RULE lives
    in core now: notifications are scoped the same way, and two copies of a
    visibility rule is one copy too many.
    """
    return await visible_pincodes(db, principal)


def _apply_visibility(stmt: Select, pincodes: Select | None | list) -> Select:
    if pincodes is None:
        return stmt
    if isinstance(pincodes, list):
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
    # One lookup for the page, not one per row. Every read here is company-
    # scoped — `scoped()` puts `company_id` in the WHERE clause of the list and
    # of fetch-by-id alike — so all these rows share a tenant and therefore one
    # "Due soon" threshold.
    warn_at_pct = (await load_rules(db, rows[0].company_id)).sla_warn_at_pct
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
                observedSerial=t.observed_serial,
                observedSerialSource=t.observed_serial_source,
                # Same rule as the jobs slice, stated once here rather than
                # imported across the slice boundary (hard rule 4).
                serialMismatch=bool(
                    t.observed_serial
                    and t.serial_number
                    and t.observed_serial.strip().upper()
                    != t.serial_number.strip().upper()
                ),
                customerName=t.customer_name,
                customerPhone=t.customer_phone,
                address=t.address,
                city=t.city,
                state=t.state,
                pincode=t.pincode,
                latitude=t.latitude,
                longitude=t.longitude,
                expectedDate=t.expected_date,
                serviceLevelHours=t.service_level_hours,
                slotStart=t.slot_start,
                slotEnd=t.slot_end,
                slaDueAt=t.sla_due_at,
                slaState=sla_state(t, warn_at_pct=warn_at_pct, now=now),
                status=t.status,
                technicianId=t.technician_id,
                technicianName=tech_names.get(t.technician_id)
                if t.technician_id
                else None,
                bonusPaise=t.bonus_paise,
                slotRequestStatus=t.slot_request_status,
                slotRequestError=t.slot_request_error,
                slotConfirmedAt=t.slot_confirmed_at,
                customerRating=t.customer_rating,
                customerFeedback=t.customer_feedback,
                customerConfirmedAt=t.customer_confirmed_at,
                # Answered, and the answer was no. `Escalated` alone will not
                # do — a ticket reaches it when nobody accepts, with no
                # customer involved at all.
                customerRefused=(
                    t.customer_confirmed_at is not None and t.status == "Escalated"
                ),
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
            # The expected serial. Mandatory on every ticket and every service
            # type, so it is always there to be found — and it is what ops are
            # read out over the phone when nobody has the ticket number.
            func.lower(Ticket.serial_number).like(term),
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
    technician_id: uuid.UUID | None = None,
    region_id: uuid.UUID | None = None,
    state_id: uuid.UUID | None = None,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
) -> tuple[list[TicketOut], int]:
    stmt = select(Ticket).where(
        Ticket.company_id == principal.company_id,
        Ticket.deleted_at.is_(None),
    )
    stmt = await scoped(db, stmt, principal)
    stmt = _apply_search(stmt, params.search)
    # The dashboard's own four, shared with `dashboard_summary` — see `narrowed`.
    # The peek table under the tiles reads this endpoint, and a table describing
    # a different set of tickets from the figures above it is worse than no
    # table at all.
    stmt = narrowed(
        stmt,
        region_id=region_id,
        state_id=state_id,
        date_from=date_from,
        date_to=date_to,
    )

    # One technician's work. The company filter above is already in the WHERE,
    # so this rides `ix_tickets_company_technician` rather than scanning — the
    # profile screen asks for it on every open.
    if technician_id is not None:
        stmt = stmt.where(Ticket.technician_id == technician_id)

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

    # This company's "Due soon" line. Read once and used by both the filter and
    # the default ordering below, so the two cannot judge a row differently.
    warn_at_pct = (await load_rules(db, principal.company_id)).sla_warn_at_pct

    wanted = _canonical(sla_filter, ("ok", "warn", "breach", "done"))
    if wanted is False:
        return [], 0
    if wanted:
        rank = {"breach": 0, "warn": 1, "ok": 2, "done": 3}[str(wanted)]
        stmt = stmt.where(_sla_order_case(warn_at_pct) == rank)

    # Default: most urgent first, which is the whole point of the screen.
    #
    # `slotStart` is the second axis, and it is a different question from
    # `createdAt`: when the WORK happens, not when the ticket was typed. They
    # disagree by days — a job booked a week out is raised long before it is
    # done — so a technician's history has to be ordered by the slot or it
    # reads out of sequence against the dates printed beside it. Nulls last
    # either way: a ticket with no slot yet is not a dated job, and Postgres
    # would otherwise sort it to the top of a descending list.
    if params.sortBy in ("createdAt", "slotStart"):
        column = (
            Ticket.created_at if params.sortBy == "createdAt" else Ticket.slot_start
        )
        direction = (
            column.asc().nulls_last()
            if params.sortDir == "asc"
            else column.desc().nulls_last()
        )
        # `created_at` breaks the tie, so two jobs in the same slot window keep
        # a stable order across pages rather than swapping between reads.
        stmt = stmt.order_by(direction, Ticket.created_at.desc())
    else:
        stmt = stmt.order_by(
            _sla_order_case(warn_at_pct).asc(), Ticket.created_at.desc()
        )

    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await _hydrate(db, rows), total


# ── the dashboard ─────────────────────────────────────────────────────────────


def narrowed(
    stmt: Select,
    *,
    region_id: uuid.UUID | None = None,
    state_id: uuid.UUID | None = None,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
) -> Select:
    """The dashboard's territory and date filters, for any ticket query.

    Shared by `dashboard_summary` and `list_tickets` so the tiles and the table
    under them cannot describe different sets of tickets — which is exactly what
    happened the first time the filters existed on only one of them: a dashboard
    reading zero everywhere, above six rows.

    ## It NARROWS; it can never widen

    The territory becomes a pincode subquery ANDed with whatever `scoped()` has
    already applied, so naming somewhere outside your own territory intersects
    to nothing and reads zero. That is the whole permission story: there is no
    separate check to keep in step with the picker, and no id here that reveals
    anything. A state beats a region because it is the narrower of the two,
    which is what a cascading picker means when both are set.

    ## The dates bound INTAKE

    `created_at`, not the slot. A slot is nullable, so bounding on it would
    silently drop every ticket nobody has booked a time for yet — precisely the
    queue the "Slot not confirmed" card exists to count. Every ticket has a
    creation instant. IST calendar days, half-open at the top, for the reasons
    `_ist_range` gives: a range somebody picks is a range in their own clock.
    """
    if state_id is not None:
        stmt = stmt.where(Ticket.pincode.in_(pincodes_in_states([state_id])))
    elif region_id is not None:
        stmt = stmt.where(Ticket.pincode.in_(pincodes_in_regions([region_id])))

    lower, upper = _ist_range(date_from, date_to)
    if lower is not None:
        stmt = stmt.where(Ticket.created_at >= lower)
    if upper is not None:
        stmt = stmt.where(Ticket.created_at < upper)
    return stmt


async def dashboard_summary(
    db: AsyncSession,
    principal: Principal,
    *,
    region_id: uuid.UUID | None = None,
    state_id: uuid.UUID | None = None,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
) -> DashboardSummaryOut:
    """Every figure the console's dashboard draws, counted rather than sampled.

    Lives in the tickets slice because every number on that screen IS a ticket
    count, and hard rule 4 is the rest of the reason: a `dashboard` slice would
    have to import `scoped`, `_sla_order_case` and `TERMINAL_STATUSES` from here,
    and a second copy of the visibility rule is how two screens start disagreeing
    about what a manager can see.

    ## Three queries, and the split is not arbitrary

    The first is one pass with conditional counts — every figure that a ticket's
    own columns can answer. The other two mirror `sweeps.sweep_force_close` and
    `sweeps.sweep_silent_slots`, which cannot fold in: both ask "when did we last
    ASK the customer", which lives in `ticket_events` and needs a correlated
    subquery. Left inside the big aggregate that subquery would run for every
    ticket in the company; as their own queries, `status` narrows to a handful
    first.

    They drop the sweeps' `_already(...)` de-dupe on purpose. A sweep asks "have
    I rung this bell", which is asked once; a dashboard asks "how much work is
    waiting", and a ticket does not stop needing a manager because it was
    announced an hour ago.

    ## The windows come from `load_rules`, not a join

    The sweeps join `company_rules` and do the interval arithmetic in SQL because
    they run across every tenant in one tick. This runs for exactly one company,
    so the rules are read once and the cutoff is a plain `timedelta` — the same
    number, arrived at more simply, and it keeps the comparison on an indexed
    column rather than inside an expression.
    """
    now = _now()
    rules = await load_rules(db, principal.company_id)
    # The same expression the list orders and filters by, so a tile and the
    # board it links to can never rank one ticket two ways.
    #   0 breach · 1 warn · 2 ok · 3 done (terminal)
    rank = _sla_order_case(rules.sla_warn_at_pct)

    lower, upper = _ist_range(date_from, date_to)

    def mine(stmt: Select) -> Select:
        return narrowed(
            stmt.where(
                Ticket.company_id == principal.company_id,
                Ticket.deleted_at.is_(None),
            ),
            region_id=region_id,
            state_id=state_id,
            date_from=date_from,
            date_to=date_to,
        )

    def tally(condition) -> object:
        """Rows matching `condition`, as a column of the one aggregate pass.

        `count`, not `sum`: `count` of a NULL-yielding CASE ignores the misses
        and returns 0 for an empty table, where `sum` returns NULL and every
        figure on an empty dashboard would come back as `None`.
        """
        return func.count(case((condition, 1)))

    is_open = Ticket.status.not_in(TERMINAL_STATUSES)
    # The escalation queue's LIVE half, exactly — `slot_end >= now`. The missed
    # half is deliberately not counted here: it only ever grows (nothing clears
    # it yet, see `list_escalations`), so folding it in would turn a number that
    # means "act today" into a number that only ever climbs, and the card's own
    # words — "unassigned within 4h" — would stop being true of it.
    is_escalated_live = (
        (Ticket.status == "Escalated")
        & Ticket.technician_id.is_(None)
        & Ticket.slot_start.is_not(None)
        & (Ticket.slot_end >= now)
    )

    # "Closed", against whichever window is in force.
    #
    # BOTH ways a job ends up finished. A force-closure is a manager settling
    # work the technician really did, and counting only customer-confirmed
    # closures would show the funnel narrowing every time a customer went quiet
    # — the opposite of what happened.
    #
    # With NO date range the tile means "closed this week", so it carries its own
    # rolling 7 days. The two statuses date differently and neither instant fits
    # the other: `customer_confirmed_at` is written in the same UPDATE that sets
    # `Closed` (see `feedback_service`) and is set on a REJECTION too, which is
    # why the status test is not redundant; a force-closed ticket has none of
    # that, so it dates off its own event, the way `awaiting` and `silent` below
    # already do.
    #
    # With a range picked, that 7 days would fight the range: "raised in March
    # AND closed in the last week" is a question nobody asked. The range wins and
    # the tile means "of the work raised in this period, how much is now done" —
    # which is why the console relabels it from "Closed this week" to "Closed".
    confirmed = Ticket.status == "Closed"
    forced = Ticket.status == "Force-Closed"
    if lower is None and upper is None:
        cutoff = now - datetime.timedelta(days=7)
        confirmed = confirmed & (Ticket.customer_confirmed_at >= cutoff)
        forced = forced & (_last_event_at("force_closed") >= cutoff)
    closed_in_window = confirmed | forced

    counts = mine(
        select(
            tally(is_open).label("open"),
            tally(rank == 0).label("breach"),
            tally(rank == 1).label("warn"),
            tally(rank == 2).label("ok"),
            tally(is_escalated_live).label("escalated"),
            tally(Ticket.status == "AI Review").label("ai"),
            tally(Ticket.status == "Slot Pending").label("slot_pending"),
            tally(Ticket.status.in_(("Assigned", "In Progress"))).label("active"),
            tally(closed_in_window).label("closed_week"),
        ).select_from(Ticket)
    )
    counts = await scoped(db, counts, principal)
    row = (await db.execute(counts)).one()

    awaiting = mine(
        select(func.count())
        .select_from(Ticket)
        .where(
            Ticket.status == "Awaiting Customer",
            Ticket.customer_confirmed_at.is_(None),
            _last_event_at("feedback_requested").is_not(None),
            _last_event_at("feedback_requested")
            <= now - datetime.timedelta(hours=rules.force_close_hours),
        )
    )
    awaiting = await scoped(db, awaiting, principal)

    silent = mine(
        select(func.count())
        .select_from(Ticket)
        .where(
            Ticket.status == "Slot Pending",
            Ticket.slot_start.is_(None),
            _last_event_at("slot_requested").is_not(None),
            _last_event_at("slot_requested")
            <= now - datetime.timedelta(hours=rules.slot_silence_hours),
        )
    )
    silent = await scoped(db, silent, principal)

    return DashboardSummaryOut(
        openTickets=row.open,
        breaching=row.breach,
        escalated=row.escalated,
        aiFlagged=row.ai,
        sla=SlaBreakdownOut(ok=row.ok, warn=row.warn, breach=row.breach),
        funnel=FunnelOut(
            slotPending=row.slot_pending,
            active=row.active,
            closedThisWeek=row.closed_week,
        ),
        attention=AttentionOut(
            escalations=row.escalated,
            aiReview=row.ai,
            awaitingForceClose=await db.scalar(awaiting) or 0,
            slotNotConfirmed=await db.scalar(silent) or 0,
            forceCloseHours=rules.force_close_hours,
            slotSilenceHours=rules.slot_silence_hours,
        ),
    )


def _last_event_at(kind: str):
    """When this ticket last had an event of `kind`, as a correlated subquery.

    `max`, not "the" event: a re-sent slot request writes another, and the
    silence being measured runs from the most recent ask rather than the first.
    The same shape the sweeps use, and for the same reason — there is no
    `slot_requested_at` column and there should not be one, because a ticket's
    history lives in `ticket_events`.
    """
    return (
        select(func.max(TicketEvent.created_at))
        .where(TicketEvent.ticket_id == Ticket.id, TicketEvent.kind == kind)
        .scalar_subquery()
    )


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
    # The nine below had no entry, so the fallback rendered the raw stored key
    # — a manager reading a timeline saw the literal word "serial_mismatch".
    # The fallback is still there for a kind added without one; it is a last
    # resort, not a naming scheme.
    "assigned": "Technician accepted",
    "started": "Proof captured — job started",
    "completed": "Technician marked it complete",
    "feedback_requested": "Confirmation link sent",
    "feedback_received": "Customer responded",
    "reopened": "Customer says it is not finished",
    "serial_mismatch": "Serial did not match the order",
    "serial_corrected": "Expected serial corrected",
    "reminded": "Technician reminded",
    "escalated": "No technician accepted",
    "bonus_added": "Bonus added and re-notified",
    # Reads next to "Technician accepted", which is the event it undoes.
    "released": "Technician cancelled",
    "no_show": "Nobody turned up",
    # Says who ended it, because that is the whole difference between this row
    # and "Customer responded" a line above. The `by` field names the manager;
    # this names the ACT, so a reader scanning the trail sees at once that the
    # customer never closed this one.
    "force_closed": "Closed by a manager",
}

#: Kinds whose wording depends on WHO caused them, keyed `(kind, actor_kind)`.
#:
#: `assigned` is the only one so far, and it is the reason this exists rather
#: than a second event kind: a job taken out of the pool and a job handed over
#: by a manager are the same FACT — this technician now owns this slot, and the
#: daily cap counts both — but they read as opposite stories. "Technician
#: accepted" over a manager's name is simply false, and adding
#: `manually_assigned` would fork every query that asks "when was this
#: assigned", including the one the cap is counted from.
_EVENT_TITLES_BY_ACTOR = {
    ("assigned", "staff"): "Assigned by a manager",
}


def _event_title(kind: str, actor_kind: str) -> str:
    return _EVENT_TITLES_BY_ACTOR.get(
        (kind, actor_kind), _EVENT_TITLES.get(kind, kind)
    )


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
            title=_event_title(e.kind, e.actor_kind),
            actorKind=e.actor_kind,
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


def clock(at: datetime.datetime) -> tuple[str, str]:
    """`('10:00', 'AM')` in IST — the two halves, so a range can share one.

    `.lstrip("0")` rather than `%-I`, which is a glibc extension and raises on
    Windows, where this very much does get run. `%I` never yields `"00"`, so
    stripping cannot empty the string.
    """
    local = at.astimezone(IST)
    return local.strftime("%I:%M").lstrip("0"), local.strftime("%p").upper()


def clock_range(start: datetime.datetime, end: datetime.datetime) -> str:
    """`10:00 AM–12:00 PM`, or `2:00–4:00 PM` when it stays inside one half.

    12-hour throughout, which is the house style taken from the approved
    prototypes — the technician app reads `4:00 PM` and its job data reads
    `2:00–4:00 PM`. A range that does not cross noon says the meridiem once.
    """
    start_hm, start_ap = clock(start)
    end_hm, end_ap = clock(end)
    if start_ap == end_ap:
        return f"{start_hm}–{end_hm} {end_ap}"
    return f"{start_hm} {start_ap}–{end_hm} {end_ap}"


def day_label(at: datetime.datetime) -> str:
    """`Thu 21 Aug` in IST — `when_label` without the clock.

    The day the WORK happens, in the day the technician experiences, which is
    the same reckoning the daily cap counts by. A UTC rendering would put a
    05:00 IST job on the previous evening and make the cap's arithmetic look
    wrong to whoever it refused.
    """
    return at.astimezone(IST).strftime("%a %d %b")


def when_label(start: datetime.datetime, end: datetime.datetime) -> str:
    """`Thu 21 Aug, 10:00 AM–12:00 PM`, in the customer's own timezone."""
    return f"{day_label(start)}, {clock_range(start, end)}"


async def _company_name(db: AsyncSession, company_id: uuid.UUID) -> str:
    # Resolved from the row rather than a constant: one WhatsApp number sends
    # for every tenant on this platform.
    return (
        await db.scalar(select(Company.name).where(Company.id == company_id))
    ) or "Reliance GreenTech Service"


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
    # Eligible technicians are now allowed to see this. The notify joins
    # THIS transaction, so it reaches their phones only if the ticket is
    # really saved, and it reaches every worker rather than only this one.
    await publish_pool_changed(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        subcategory_id=row.subcategory_id,
    )
    await publish_ticket_changed(db, row)
    await db.commit()

    # After the commit, and never inside it: this is a network call to Expo,
    # and a slot confirmation must not be lost because a push service was slow.
    await _push_pool_job(db, row)
    await db.refresh(row)

    sent = await _send_slot_confirmed(db, row)
    if sent is not None:
        db.add(sent)
        # The doorbell above rang before this row existed. Without this one the
        # `confirmation_sent` entry is invisible to an open console until it is
        # reloaded — see the same pattern at the end of `create_ticket`.
        await publish_ticket_changed(db, row)
        await db.commit()
    return row


# ── write ─────────────────────────────────────────────────────────────────────


async def create_ticket(
    db: AsyncSession, principal: Principal, body: TicketCreateRequest
) -> TicketOut:
    vendor, subcategory, model = await _resolve_product(db, principal, body)

    now = _now()
    # A day that has already gone cannot be served. Judged in IST, not UTC:
    # for five and a half hours every evening the two disagree about what day
    # it is, and the vendor typing this is in the former.
    if body.expectedDate < now.astimezone(IST).date():
        raise _bad_request(
            "The expected date has already passed — pick today or later."
        )

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
        # Null unless the client resolved the address through a map. That null
        # is what puts this ticket on the pincode rule at proof time rather
        # than the distance one — see `jobs.service`.
        latitude=body.latitude,
        longitude=body.longitude,
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
    # After the row, because the rule is expressed against `sla_due_at` — which
    # is only known once the service level and the creation instant are both on
    # it. Nothing has been added to the session yet, so a refusal writes nothing.
    check_slot_bookable(row, now=now)
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
        # A ticket raised WITH a time is already in the pool, so it rings now.
        # One without is 'Slot Pending' and nobody may see it yet — its ring
        # comes later, from `confirm_slot`.
        await publish_pool_changed(
            db,
            company_id=row.company_id,
            pincode=row.pincode,
            subcategory_id=row.subcategory_id,
        )
    # A new ticket is movement the console should see appear.
    await publish_ticket_changed(db, row)
    await db.commit()

    # No outer condition needed: `_push_pool_job` checks that the ticket is
    # actually in the pool, which is the same test the `publish_pool_changed`
    # above is nested under.
    await _push_pool_job(db, row)
    await db.refresh(row)

    # Both branches tell the customer something, and neither can fail the
    # request: the ticket is saved before either is attempted, and a refusal is
    # recorded rather than raised.
    if row.slot_start is not None:
        sent = await _send_slot_confirmed(db, row)
        if sent is not None:
            db.add(sent)
            # A SECOND doorbell, and it is not redundant. The one above rang at
            # the first commit; this row lands after it, so a console already
            # watching this ticket would hold a timeline missing its newest
            # entry until somebody reloaded the page by hand.
            await publish_ticket_changed(db, row)
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
        # Same again, and this branch matters more: "Could not send" is the row
        # somebody has to act on, and it is the one that would have sat unseen.
        await publish_ticket_changed(db, row)
        await db.commit()

    return (await _hydrate(db, [row]))[0]


async def list_proof(
    db: AsyncSession, principal: Principal, ticket_id: uuid.UUID
) -> list[TicketProofOut]:
    """The proof captured on one ticket, for whoever is entitled to see it.

    Entitlement is `_load`'s, unchanged and not re-stated here — which is the
    point. Staff see it if the ticket is in their territory, a vendor if the
    ticket is theirs, a vendor user only if they raised it, and a technician not
    at all through this route (they have `/jobs/{id}/proof` for their own work).
    One rule, one place; a second copy would be the one that drifts.

    404 rather than an empty list when the ticket is not visible, because an
    empty list is an answer and "this ticket exists but is not yours" is not one
    we want to give.
    """
    row = await _load(db, principal, ticket_id)

    rows = await db.scalars(
        select(TicketProof)
        .where(
            TicketProof.company_id == row.company_id,
            TicketProof.ticket_id == row.id,
        )
        .order_by(TicketProof.captured_at.asc(), TicketProof.ordinal.asc())
    )
    # Same belt-and-braces as the jobs slice: signing is the step that hands the
    # bytes over, so a name outside this company's prefix is never signed.
    prefix = f"proof/{row.company_id}/"
    return [
        TicketProofOut(
            kind=p.kind,
            ordinal=p.ordinal,
            capturedAt=p.captured_at,
            url=blob.signed_url(p.blob_name) if p.blob_name.startswith(prefix) else None,
            latitude=p.latitude,
            longitude=p.longitude,
            accuracyM=p.accuracy_m,
            devicePincode=p.device_pincode,
        )
        for p in rows
    ]


async def correct_serial(
    db: AsyncSession,
    principal: Principal,
    ticket_id: uuid.UUID,
    *,
    serial_number: str,
    reason: str | None,
) -> TicketDetailOut:
    """Fix the expected serial on a ticket.

    Open to whoever can already see the ticket — which by `_load` means staff in
    its territory and the vendor that raised it. The vendor is the important
    one: they hold the invoice, so when the number was mistyped at intake they
    are the party who can actually say what it should be, and making them phone
    a manager to correct their own typo is the kind of process that gets worked
    around instead of followed.

    It does NOT touch `observed_serial`. What the technician read on site is a
    record of what was on the unit; correcting the order must never quietly
    rewrite the evidence it disagreed with.

    Recorded as an event carrying BOTH values, because "what did it say before"
    is the first question anybody auditing a corrected serial will ask.
    """
    row = await _load(db, principal, ticket_id)

    was = row.serial_number
    now = serial_number.strip()
    if now == was:
        # Nothing changed. Writing an event saying so would be noise in a trail
        # whose value is that every row means something.
        return await get_ticket(db, principal, ticket_id)

    row.serial_number = now
    db.add(
        record_event(
            row,
            "serial_corrected",
            actor_kind="vendor" if principal.is_vendor else "staff",
            actor_label=principal.user.full_name or "—",
            note=(
                f"Expected serial corrected from {was} to {now}"
                + (f" — {reason.strip()}" if reason and reason.strip() else "")
            ),
            by_user=principal.user_id,
        )
    )
    await publish_ticket_changed(db, row)
    await db.commit()
    return await get_ticket(db, principal, ticket_id)


# ── escalation: nobody accepted, so a manager owns it ────────────────────────
#
# Reached by `sweeps.sweep_unaccepted`, which moves an unaccepted job to
# `Escalated` and takes it out of the pool. There are exactly two ways back out,
# both below, and both are settled by a guarded UPDATE for the reason
# `jobs.service.accept` is: a read followed by a write leaves a window, and the
# thing racing us here is a technician tapping Accept on a card they are still
# looking at.
#
# Every query carries `technician_id IS NULL`. `Escalated` also means "the
# customer said it was not done", and that one always HAS a technician — telling
# the two apart by the column rather than by a second status is what keeps the
# customer-refusal path working unchanged.


#: The statuses a manager may assign FROM.
#:
#: Not a blanket "anything non-terminal". Past `Assigned` the technician is on
#: site with proof captured, and moving the job then is a different and messier
#: operation than this one — it would strand evidence against a person who is no
#: longer on the ticket. `New` is here because the console's "Re-assign" button
#: is reachable from an ordinary pooled job, not only from the escalation queue.
ASSIGNABLE_STATUSES = ("New", "Escalated", "Assigned")


def _refused(code: str, detail: str) -> AppError:
    """A 409 that says which kind of "no" it is.

    Mirrors `jobs.service.JobRefused` rather than importing it — hard rule 4,
    and the audiences differ anyway: these sentences are read by a manager
    deciding who to send, not by a technician deciding whether to tap again.
    """
    return AppError(http_status.HTTP_409_CONFLICT, code, detail)


#: Which half of the queue to show: the jobs that can still be rescued, or the
#: record of the ones that were not.
#:
#: The only categorical filter here, deliberately. It is the cut that maps onto
#: the two different sittings the screen gets — working live jobs, and ringing
#: the customers behind the missed ones — so it changes what a manager DOES.
#:
#: Deliberately NOT offered: service type, subcategory, status, and bonus.
#: Status is fixed (`Escalated`, unassigned) or the row would not be here; the
#: first two are not on the card, and a filter for something the reader cannot
#: see the result of is a control that makes a list mysteriously shorter. Bonus
#: was built, tested and removed: whether money has been spent is already a
#: figure on every card, so the parameter bought a second row of controls for
#: something the eye does in one pass.
ESCALATION_HALVES = ("live", "missed")


def _ist_range(
    start: datetime.date | None, end: datetime.date | None
) -> tuple[datetime.datetime | None, datetime.datetime | None]:
    """Two IST calendar dates as a half-open UTC range, both ends inclusive.

    IST because a slot is a promise made in the customer's own clock — the same
    reckoning the daily cap counts by and the console's dividers group by. A UTC
    comparison would put a 05:00 IST job on the previous day and quietly drop it
    out of a range a manager could see it inside of.

    Half-open at the top (`< midnight after `end``) rather than `<=` on the end
    date, so a slot at 11:59 PM on the last day is included. Written as a range
    rather than a date cast for the reason `ist_day_bounds` gives: the cast is
    STABLE, not IMMUTABLE, and Postgres will not use an index through it.
    """
    lower = ist_day_bounds(_as_ist_noon(start))[0] if start else None
    upper = ist_day_bounds(_as_ist_noon(end))[1] if end else None
    return lower, upper


def _as_ist_noon(day: datetime.date) -> datetime.datetime:
    """A bare date as an instant safely inside that IST day.

    Noon, not midnight: `ist_day_bounds` reads the IST day CONTAINING the
    instant it is given, and midnight-UTC on the same date is 5:30 AM IST — the
    same day, but only by 5½ hours of luck. Noon has eleven hours of margin at
    either end and cannot be pushed into a neighbouring day by any offset this
    product will ever see.
    """
    return datetime.datetime.combine(day, datetime.time(12), tzinfo=IST)


async def list_escalations(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    half: str | None = None,
    slot_from: datetime.date | None = None,
    slot_to: datetime.date | None = None,
    region_id: uuid.UUID | None = None,
    state_id: uuid.UUID | None = None,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
) -> tuple[list[TicketOut], int]:
    """Jobs that reached their escalation window with nobody on them.

    Paginated, but the console never shows a pager: it loads the next page on
    scroll, so nothing is ever behind a page number. That distinction is the
    whole reason this endpoint took a page parameter late — every row is a
    customer holding a confirmed slot that is counting down, and a row on an
    invisible page two is a missed appointment. Bounding the RESPONSE is fine;
    bounding what a manager can reach is not.

    What makes that safe is the ordering below: live rows are page one by
    construction, so the half that can still be rescued is never the half that
    needs scrolling to reach.

    Territory narrowing is free: it goes through `scoped()`, the same door the
    list and fetch-by-id use, so an Area Manager sees their own states, a
    Regional Head their region, and an all-India role everything. A vendor
    reaching this is refused by the router's rank floor long before here.

    ## Two lists in one, and the order is what separates them

    Rows whose slot has already CLOSED are still returned — a missed
    appointment is a customer owed an apology, and a queue that quietly dropped
    its own failures would be the least honest screen in the product. But they
    are not the same work as a job that can still be saved, and mixed together
    they bury it: after a few weeks the live rows are a handful among dozens of
    dead ones and the screen stops being read.

    So they are ordered LAST and the console draws them under their own
    heading. `slot_end` is the divider rather than `slot_start` — while the
    window is open somebody can still be sent.

    Soonest slot first throughout: in the live half that is the job most at
    risk, and in the missed half it is the customer who has been waiting
    longest for somebody to ring them.

    ⚠ **Nothing clears the missed half yet.** Re-slotting a job whose time has
    passed means asking the customer for another one, which is a conversation
    and not a status change. Until that exists this list only grows, which is
    also why the count sits on its own heading rather than in the rail's badge.
    It is also why paging arrived: an ever-growing list was going to be sent
    whole on every poll.
    """
    now = _now()
    stmt = select(Ticket).where(
        Ticket.company_id == principal.company_id,
        Ticket.deleted_at.is_(None),
        Ticket.status == "Escalated",
        # The customer-refusal escalation always has a technician. This queue is
        # about the jobs that have nobody.
        Ticket.technician_id.is_(None),
        Ticket.slot_start.is_not(None),
    )
    stmt = await scoped(db, stmt, principal)
    # The dashboard's four, so its "Escalations · 2" card opens a queue holding
    # exactly those two. `date_from`/`date_to` bound INTAKE here, the same as
    # everywhere else `narrowed` is used — they are a different question from
    # `slot_from`/`slot_to` below, which bound the day the work was promised.
    stmt = narrowed(
        stmt,
        region_id=region_id,
        state_id=state_id,
        date_from=date_from,
        date_to=date_to,
    )
    # The same predicate the ticket board searches by — code, customer, phone,
    # pincode, serial — so a manager who found a job on one screen finds it here
    # by typing the same thing. A second, cleverer search would be a second set
    # of rules to learn.
    stmt = _apply_search(stmt, params.search)

    wanted = _canonical(half, ESCALATION_HALVES)
    if wanted is False:
        return [], 0
    if wanted == "live":
        # `slot_end`, not `slot_start`: while the window is open somebody can
        # still be sent. The same test the ordering below uses, so the filter
        # and the sections it hides cannot disagree about which half a row is
        # in.
        stmt = stmt.where(Ticket.slot_end >= now)
    elif wanted == "missed":
        stmt = stmt.where(Ticket.slot_end < now)

    # On SLOT date — when the work was promised — not on when the ticket was
    # raised. Those two disagree by days on any job booked ahead, and it is the
    # slot the cards print, the dividers group by and a customer rings about.
    #
    # Either end alone is a valid question: "since the 20th" and "up to the
    # 20th" are both things somebody asks. Only the missed half is really long
    # enough to need this, but it is not restricted to that half — a range that
    # silently ignored live rows would be a filter that lies about its own
    # scope.
    lower, upper = _ist_range(slot_from, slot_to)
    if lower is not None:
        stmt = stmt.where(Ticket.slot_start >= lower)
    if upper is not None:
        stmt = stmt.where(Ticket.slot_start < upper)

    # Live first, missed after — one expression, so the API's order and the
    # console's heading cannot disagree about which half a row is in. With
    # paging it does a second job: the live rows fill page one, so the work that
    # is still savable never sits below a scroll the manager has to trigger.
    is_missed = case((Ticket.slot_end < now, 1), else_=0)
    # The two halves run in OPPOSITE directions, and each is the useful one for
    # what its rows are for.
    #
    #   live   — soonest slot first: the job closest to being missed.
    #   missed — most recent first: what just went wrong is what somebody can
    #            still ring a customer about. Oldest-first buried today's misses
    #            under every one since the queue began, and since nothing clears
    #            the missed half, that gap only widens.
    #
    # Expressed as a signed epoch so both halves sort ASCENDING on one key.
    # Ordering by `slot_start` twice with different directions would need the
    # halves to be separate queries, and then paging could not span them.
    epoch = func.extract("epoch", Ticket.slot_start)
    within_half = case((Ticket.slot_end < now, -epoch), else_=epoch)
    stmt = stmt.order_by(
        is_missed.asc(),
        within_half.asc(),
        # A stable tiebreak, or two jobs sharing a slot can swap between pages
        # and the reader sees one twice and the other never.
        Ticket.id.asc(),
    )
    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await _hydrate(db, rows), total


async def _load_assignable_technician(
    db: AsyncSession, principal: Principal, row: Ticket, technician_id: uuid.UUID
) -> TechnicianProfile:
    """The technician a manager picked, or a refusal that says why not.

    The eligibility rules are `jobs.service.pool_query`'s, minus the two a
    manager is allowed to overrule:

    * **Coverage and certification are enforced.** Sending somebody to a pincode
      they do not work, or to a product they are not certified on, is not an
      override — it is a job that will fail on arrival.
    * **`status == ACTIVE` is enforced.** Suspension is somebody else's decision
      about this technician and is not a manager's to route around.
    * **The daily cap is enforced**, because the shortlist shows capacity and
      the manager can pick somebody with room. If nobody has room, that is a
      real staffing problem worth surfacing rather than silently spending.
    * **`accepting_work` is NOT enforced.** An assignment is a directive, not an
      offer, and this is the last resort the requirement document reaches for
      when re-notification has already failed. The console flags who is offline
      so the choice is made knowingly.

    A technician from another company reads 404, not 403 — hard rule 1: a 403
    would confirm they exist.
    """
    profile = await db.scalar(
        select(TechnicianProfile).where(
            TechnicianProfile.id == technician_id,
            TechnicianProfile.company_id == principal.company_id,
        )
    )
    if profile is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Technician not found",
        )

    if profile.status != ACTIVE:
        raise _refused(
            "TECHNICIAN_SUSPENDED",
            "This technician is not active and cannot be assigned work.",
        )

    covers = await db.scalar(
        select(TechnicianPincode.id).where(
            TechnicianPincode.company_id == principal.company_id,
            TechnicianPincode.technician_id == profile.id,
            TechnicianPincode.pincode == row.pincode,
        )
    )
    certified = await db.scalar(
        select(TechnicianSubcategory.id).where(
            TechnicianSubcategory.company_id == principal.company_id,
            TechnicianSubcategory.technician_id == profile.id,
            TechnicianSubcategory.subcategory_id == row.subcategory_id,
        )
    )
    # Named individually. "Ineligible" leaves a manager guessing which of two
    # masters to go and fix, and both fixes are on different screens.
    if covers is None:
        raise _refused(
            "TECHNICIAN_INELIGIBLE",
            f"This technician does not cover {row.pincode}. Add it to their "
            "coverage, or choose another technician.",
        )
    if certified is None:
        raise _refused(
            "TECHNICIAN_INELIGIBLE",
            "This technician is not certified for this product category.",
        )
    return profile


async def assign_technician(
    db: AsyncSession,
    principal: Principal,
    ticket_id: uuid.UUID,
    *,
    technician_id: uuid.UUID,
) -> TicketDetailOut:
    """Hand the job to a named technician. The last resort in §7.

    Writes the same `assigned` event `jobs.service.accept` writes, with
    `actor_kind="staff"` — one fact, two ways of arriving at it. That matters
    beyond the timeline: the daily cap counts assignments from those rows, and
    a job a manager handed over spends the technician's day exactly as one they
    chose. A second event kind would have forked every query that asks when a
    ticket was assigned, including the one the cap is counted from.

    Deliberately NO future-slot check. `pool_query` hides a window that has
    already opened because a technician cannot travel to it — but a manual
    assignment is precisely the override for that case, and refusing it would
    disarm the tool in the emergency it exists for.
    """
    row = await _load(db, principal, ticket_id)

    if row.status not in ASSIGNABLE_STATUSES:
        raise _refused(
            "TICKET_NOT_ASSIGNABLE",
            f"This ticket is {row.status} and can no longer be assigned."
            + (
                " The technician has already started it, so they must cancel "
                "it first."
                if row.status not in TERMINAL_STATUSES
                else ""
            ),
        )
    if row.slot_start is None:
        raise _refused(
            "NO_SLOT",
            "This ticket has no confirmed slot yet. Agree a time with the "
            "customer before assigning anyone.",
        )

    profile = await _load_assignable_technician(db, principal, row, technician_id)
    if profile.id == row.technician_id:
        # Re-assigning somebody to their own job is a no-op the trail should not
        # record. Same reasoning as `correct_serial` returning early.
        return await get_ticket(db, principal, ticket_id)

    was = row.status
    previous = row.technician_id
    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == principal.company_id,
            Ticket.status.in_(ASSIGNABLE_STATUSES),
            # Whoever the row named when we read it is who it must still name.
            # This is what makes two managers assigning at once safe, and what
            # stops a manager overwriting a technician who accepted from the
            # pool a second earlier.
            Ticket.technician_id.is_(None)
            if previous is None
            else Ticket.technician_id == previous,
            # Re-tested here and not only in the read above, because the read is
            # a read: two managers filling the same technician's day at the same
            # moment both pass it. Settled in the WHERE clause, Postgres
            # serialises them and the second matches nothing.
            has_cap_room(
                company_id=principal.company_id, technician_id=profile.id
            ),
        )
        .values(technician_id=profile.id, status="Assigned")
    )
    if result.rowcount == 0:
        # Two reasons, and the manager can act on only one. Read the ticket
        # rather than re-running the cap: if it is still where we left it, the
        # cap is the only clause that can have failed.
        unchanged = await db.scalar(
            select(Ticket.id).where(
                Ticket.id == ticket_id,
                Ticket.company_id == principal.company_id,
                Ticket.status.in_(ASSIGNABLE_STATUSES),
                Ticket.technician_id.is_(None)
                if previous is None
                else Ticket.technician_id == previous,
            )
        )
        if unchanged is not None:
            raise _refused(
                "DAILY_CAP_REACHED",
                f"{profile.code} already has {profile.daily_job_cap} jobs on "
                f"{day_label(row.slot_start)}, which is their daily limit. "
                "Choose another technician, or raise their limit first.",
            )
        raise _refused(
            "ALREADY_ASSIGNED",
            "This ticket has already been updated. Reload the page and try "
            "again.",
        )

    row.status = "Assigned"
    row.technician_id = profile.id
    name = await _technician_name(db, profile)
    db.add(
        record_event(
            row,
            "assigned",
            actor_kind="staff",
            actor_label=principal.user.full_name or "—",
            from_status=was,
            to_status="Assigned",
            note=(
                f"Assigned to {name}"
                if previous is None
                else f"Re-assigned to {name}"
            ),
            by_user=principal.user_id,
        )
    )
    # NB no ledger entry here. A funded bonus is paid to whoever FINISHES the
    # job, in `jobs.service.complete`, and this slice deliberately does not
    # duplicate that: assigning somebody is not the same as them having done
    # it, and a manager re-assigning a bonused ticket would otherwise pay for
    # it twice.
    #
    # It does mean a technician a manager hands the job to earns the bonus on
    # the same terms as one who volunteered. Decided that way on purpose:
    # withholding it would pay less for the harder version of the same favour.
    #
    # It has left the pool (or was never in it), and the technician's own
    # job list has gained a row. Two different doorbells for two different
    # audiences, both inside the transaction that made the change true.
    await publish_pool_changed(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        subcategory_id=row.subcategory_id,
    )
    await publish_job_changed(
        db,
        company_id=row.company_id,
        technician_id=profile.id,
        ticket_id=row.id,
    )
    await publish_ticket_changed(db, row)
    await db.commit()

    # After the commit, like every other outbound side effect here: a push about
    # an assignment that then rolled back is worse than a late one. They did not
    # ask for this job, so being told is not optional.
    assert row.slot_end is not None  # both-or-neither, and the start is set
    await send_to_technician(
        db,
        company_id=row.company_id,
        technician_id=profile.id,
        title=f"{row.code} assigned to you",
        body=f"{row.city} {row.pincode} · {when_label(row.slot_start, row.slot_end)}",
        data={"type": "job", "ticketId": str(row.id), "code": row.code},
    )
    return await get_ticket(db, principal, ticket_id)


async def _technician_name(
    db: AsyncSession, profile: TechnicianProfile
) -> str:
    """The person's name, for the trail. Their code if the join comes up empty."""
    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.id == profile.membership_id)
    )
    return name or profile.code


async def add_bonus_and_renotify(
    db: AsyncSession,
    principal: Principal,
    ticket_id: uuid.UUID,
    *,
    amount_paise: int,
) -> RenotifyOut:
    """Fund an incentive and put the job back in the pool.

    §7's first remedy, and the one to try before assigning by hand: the slot
    stays exactly where the customer put it, and the job goes back to every
    eligible technician with money attached.

    The bonus REPLACES any previous one. The approved button reads "Add ₹400
    bonus & re-notify", and a second press meaning ₹800 would be a manager
    spending money they did not think they were spending. Every amount ever
    funded is still in the trail as its own `bonus_added` row, which is where
    "what did we pay to fill this" is answerable from.

    `sweeps.sweep_unaccepted` will escalate it again if it is still empty after
    this company's `renotify_grace_minutes` — the grace exists precisely because
    the ticket is going back into a window it never left, and without it the
    next tick five minutes later would take it straight back out.
    """
    row = await _load(db, principal, ticket_id)

    if row.status != "Escalated" or row.technician_id is not None:
        raise _refused(
            "NOT_ESCALATED",
            "A bonus can only be added to a job that nobody has accepted. "
            f"This ticket is {row.status}.",
        )
    assert row.slot_start is not None  # `Escalated` with no technician implies one

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == principal.company_id,
            Ticket.status == "Escalated",
            Ticket.technician_id.is_(None),
        )
        .values(status="New", bonus_paise=amount_paise)
    )
    if result.rowcount == 0:
        raise _refused(
            "ALREADY_ASSIGNED",
            "This ticket has already been updated. Reload the page and try "
            "again.",
        )

    row.status = "New"
    row.bonus_paise = amount_paise
    db.add(
        record_event(
            row,
            "bonus_added",
            actor_kind="staff",
            actor_label=principal.user.full_name or "—",
            from_status="Escalated",
            to_status="New",
            note=f"₹{amount_paise // 100:,} bonus · back in the pool",
            by_user=principal.user_id,
        )
    )
    await publish_pool_changed(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        subcategory_id=row.subcategory_id,
    )
    await publish_ticket_changed(db, row)
    await db.commit()

    # Who it actually reached — read AFTER the commit and with the same
    # predicate the push uses, so the number the manager is shown is the number
    # of phones that rang rather than an estimate of it. Zero is a real answer
    # and an important one: it means no bonus can work here, because nobody
    # covers this pincode for this product with room on that day.
    audience = await technicians_covering(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        subcategory_id=row.subcategory_id,
        slot_start=row.slot_start,
    )
    await _push_pool_job(db, row)
    return RenotifyOut(
        ticket=await get_ticket(db, principal, ticket_id), notified=len(audience)
    )


async def record_no_show(
    db: AsyncSession,
    principal: Principal,
    ticket_id: uuid.UUID,
    *,
    note: str | None = None,
) -> TicketDetailOut:
    """Confirm that nobody turned up, charge the band, and free the job.

    `sweeps.sweep_no_shows` finds these and deliberately stops there. This is
    the other half: a PERSON deciding that the technician really did fail to
    appear, which is a judgement a clock cannot make. A dead phone and a
    deliberate no-show look identical in the data, and the no-show band is the
    most expensive one there is.

    Three things happen together, in one transaction:

    * the technician is released from the job and charged the `No-show` band —
      the LAST entry of `cancel_penalties_paise`, the one
      `core.rules.cancel_band_index` can never return;
    * a `no_show` event records who decided it and why;
    * the ticket goes to `Escalated` with no technician, which is where a job
      needing a new slot belongs and where the manager is already working.

    It does NOT re-open the pool. The slot has closed, so there is nothing left
    to offer — the customer has to be asked for a new time, and that is a
    conversation rather than a status change.

    The monthly cap applies exactly as it does to a cancellation, and for the
    same reason: it is a cap on what one technician can be charged in a month,
    not a cap per kind of failure.
    """
    row = await _load(db, principal, ticket_id)

    if row.status != "Assigned" or row.technician_id is None:
        raise _refused(
            "NOT_A_NO_SHOW",
            "A no-show can only be recorded on an assigned job that was never "
            f"started. This ticket is {row.status}.",
        )
    if row.slot_end is None or row.slot_end >= _now():
        raise _refused(
            "SLOT_STILL_OPEN",
            "The slot has not closed yet. You can record a no-show once it "
            "ends.",
        )

    profile = await db.scalar(
        select(TechnicianProfile).where(
            TechnicianProfile.id == row.technician_id,
            TechnicianProfile.company_id == principal.company_id,
        )
    )
    if profile is None:  # a technician hard-deleted under a live ticket
        raise _not_found()

    # The same row lock the cancel path takes, for the same reason: the amount
    # depends on a sum of rows already written, so the read and the write must
    # not be interleaved with another charge against this technician.
    await db.refresh(profile, with_for_update=True)

    rules = await load_rules(db, principal.company_id)
    label = CANCEL_PENALTY_BANDS[-1]
    band = int(rules.cancel_penalties_paise[-1])
    already = await charged_this_month(
        db, company_id=principal.company_id, technician_id=profile.id
    )
    remaining = cap_remaining(
        cap_paise=rules.cancel_penalty_cap_paise, already_charged=already
    )
    charge = band if remaining is None else min(band, remaining)

    technician_id = row.technician_id
    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == principal.company_id,
            Ticket.status == "Assigned",
            Ticket.technician_id == technician_id,
        )
        .values(technician_id=None, status="Escalated")
    )
    if result.rowcount == 0:
        raise _refused(
            "NOT_A_NO_SHOW",
            "This ticket has already been updated. Reload the page and try "
            "again.",
        )
    row.status = "Escalated"
    row.technician_id = None

    name = await _technician_name(db, profile)
    db.add(
        record_event(
            row,
            "no_show",
            actor_kind="staff",
            actor_label=principal.user.full_name or "—",
            from_status="Assigned",
            to_status="Escalated",
            note=(
                f"{name} did not attend · {label} · ₹{charge // 100:,}"
                + (f" · {note.strip()}" if note and note.strip() else "")
            ),
            by_user=principal.user_id,
        )
    )
    # Same rule as a cancellation: a technician whose monthly cap is already
    # spent owes nothing more, and the absence of a charge is written as the
    # absence of a row rather than as a zero.
    if charge > 0:
        db.add(
            ledger_entry(
                company_id=principal.company_id,
                technician_id=profile.id,
                ticket_id=row.id,
                kind="penalty",
                amount_paise=charge,
                # The band's own words. Every other ledger reason is prefixed
                # with what happened ("Cancel > 4h before slot"); this band's
                # label already IS what happened.
                reason=label,
                by_user=principal.user_id,
            )
        )
    # It counts against them exactly as a cancellation does. Not turning up is
    # the worse version of the same failure, and a profile that counted only
    # the honest ones would flatter whoever stopped cancelling.
    profile.jobs_cancelled = (profile.jobs_cancelled or 0) + 1

    await publish_ticket_changed(db, row)
    await publish_job_changed(
        db,
        company_id=principal.company_id,
        technician_id=technician_id,
        ticket_id=row.id,
    )
    await db.commit()
    return await get_ticket(db, principal, ticket_id)


#: Where a force-closure attachment lives. Mirrors the `proof/` prefix and
#: exists for the same reason: a blob name is the only thing a client hands us
#: here, so the prefix is what makes "this file is ours" checkable.
_ATTACHMENT_PREFIX = "attachment"


async def force_close_ticket(
    db: AsyncSession,
    principal: Principal,
    ticket_id: uuid.UUID,
    body: ForceCloseRequest,
) -> TicketDetailOut:
    """End a job the normal closure could not finish, on a manager's authority.

    Only the CUSTOMER closes a job here — deliberately, because the technician's
    word starts a question rather than settling it, and `Awaiting Customer` is
    where that question waits. The design has exactly one hole: a customer who
    says nothing at all. `sweeps.sweep_force_close` finds those and stops, on
    purpose; this is the other half, a person deciding the job really is done.

    It is also the ONLY exit from the live set other than a customer confirming.
    Nothing in this codebase writes `Cancelled`, so without this a silent
    customer leaves a ticket that never settles: the technician is never
    credited and the SLA clock never stops.

    Allowed on any non-terminal ticket, not only on `Awaiting Customer`. The
    sweep and the dashboard card both point at the silent-customer case because
    it is the common one, but a job that can never proceed for some other reason
    is the same problem, and a manager who cannot end it has no other tool.

    Three things happen together, in one transaction:

    * the ticket goes to `Force-Closed`, keeping its technician — they did the
      work, and clearing the link would lose who to credit;
    * a `force_closed` event records who ended it, when, and on what basis;
    * the supporting files are written as `ticket_attachments` rows.

    **No ledger entry.** `tickets` has no payout column, so what a job pays is
    unknown — a credit invented here would be a number with no source.
    """
    row = await _load(db, principal, ticket_id)

    if row.status in TERMINAL_STATUSES:
        raise _refused(
            "ALREADY_SETTLED",
            f"This ticket is already {row.status}. There is nothing left to "
            "close.",
        )

    # A blob name is the only thing the client hands over, so this is the check
    # that keeps one company's evidence off another company's ticket — the same
    # belt-and-braces `list_proof` applies before it signs anything.
    prefix = f"{_ATTACHMENT_PREFIX}/{principal.company_id}/"
    stray = [a.blobName for a in body.attachments if not a.blobName.startswith(prefix)]
    if stray:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Those attachments were not uploaded here. Upload them again "
                "and retry."
            ),
        )

    was = row.status
    technician_id = row.technician_id

    # The concurrency check, and the reason the status test above is not enough:
    # a colleague can close this ticket in the seconds between that read and
    # this write. Guarded on the same set rather than on `was`, so a ticket that
    # moved to any other LIVE status in between still closes — what must not
    # happen is closing one that has already settled.
    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == principal.company_id,
            Ticket.status.not_in(TERMINAL_STATUSES),
        )
        .values(status="Force-Closed")
    )
    if result.rowcount == 0:
        raise _refused(
            "ALREADY_SETTLED",
            "This ticket has already been closed. Reload the page to see how.",
        )
    row.status = "Force-Closed"

    reason = body.reason.strip()
    notes = body.notes.strip()
    db.add(
        record_event(
            row,
            "force_closed",
            actor_kind="staff",
            actor_label=principal.user.full_name or "—",
            from_status=was,
            to_status="Force-Closed",
            # Both, and in this order: the reason says which of the situations
            # this was, the note says what was actually tried. A trail carrying
            # only the first is a category with no evidence behind it.
            note=f"{reason} · {notes}",
            by_user=principal.user_id,
        )
    )
    for ordinal, attachment in enumerate(body.attachments, start=1):
        db.add(
            TicketAttachment(
                company_id=principal.company_id,
                ticket_id=row.id,
                ordinal=ordinal,
                blob_name=attachment.blobName,
                file_name=attachment.fileName,
                created_by=principal.user_id,
            )
        )

    await publish_ticket_changed(db, row)
    if technician_id is not None:
        await publish_job_changed(
            db,
            company_id=principal.company_id,
            technician_id=technician_id,
            ticket_id=row.id,
        )
    await db.commit()

    if technician_id is not None:
        # After the commit, both of these. The push tells somebody the job they
        # were waiting on has been settled without them, and the stats query
        # has to see the row this transaction just wrote.
        await send_to_technician(
            db,
            company_id=principal.company_id,
            technician_id=technician_id,
            title=f"{row.code} closed by the office",
            body=(
                "The customer never responded, so a manager closed this job. "
                "It counts as completed."
            ),
            data={"type": "job", "ticketId": str(row.id), "code": row.code},
        )
        await refresh_technician_stats(
            db, company_id=principal.company_id, technician_id=technician_id
        )

    return await get_ticket(db, principal, ticket_id)


async def list_attachments(
    db: AsyncSession, principal: Principal, ticket_id: uuid.UUID
) -> list[TicketAttachmentOut]:
    """The evidence behind a force-closure, for the staff who may audit it.

    Entitlement is `_load`'s, exactly as `list_proof` leaves it there — one
    rule, one place. 404 rather than an empty list when the ticket is not
    visible: an empty list is an answer, and "this ticket exists but is not
    yours" is not one we want to give.

    **Staff only**, which is the one place this parts company with `list_proof`.
    Proof is the work the vendor is being billed for and they are entitled to
    see it. These files are the OFFICE's justification for closing without the
    customer — an internal call log, an acknowledgement carrying a customer's
    signature — and the vendor is the outside party the decision was taken
    about. They still see that it happened, and why: the `force_closed` event
    is on the timeline they already read, carrying the reason and the note.

    The console renders this panel only for ops, but that is presentation. Hard
    rule 8 — hiding UI is never authorization — so the refusal lives here.
    """
    if principal.vendor_id is not None:
        raise _not_found()

    row = await _load(db, principal, ticket_id)

    rows = await db.scalars(
        select(TicketAttachment)
        .where(
            TicketAttachment.company_id == row.company_id,
            TicketAttachment.ticket_id == row.id,
        )
        .order_by(TicketAttachment.ordinal.asc())
    )
    # Same guard as `list_proof`: signing is the step that hands the bytes over,
    # so a name outside this company's prefix is never signed.
    prefix = f"{_ATTACHMENT_PREFIX}/{row.company_id}/"
    return [
        TicketAttachmentOut(
            ordinal=a.ordinal,
            fileName=a.file_name,
            url=blob.signed_url(a.blob_name) if a.blob_name.startswith(prefix) else None,
            uploadedAt=a.created_at,
        )
        for a in rows
    ]


async def _push_pool_job(db: AsyncSession, row: Ticket) -> None:
    """Tell eligible technicians' phones that this job is takeable.

    Guarded on the ticket really being in the pool. Both callers establish that
    before getting here, but they do it in two different places and only one of
    them is obvious from the call site.
    """
    if row.status != "New" or row.technician_id is not None:
        return
    await announce_pool_job(
        db,
        company_id=row.company_id,
        ticket_id=row.id,
        code=row.code,
        pincode=row.pincode,
        city=row.city,
        subcategory_id=row.subcategory_id,
        # So a technician whose day is already full is not told about it.
        slot_start=row.slot_start,
    )
