"""Ticket endpoints — intake and the list.

**Only a vendor raises a ticket.** `jobs.create` is held by the two portal roles
and nobody else, and `POST` carries `require_vendor_principal` ON TOP of the
feature. The guard is not belt-and-braces: a feature grant is deliberately
overridable per company through Feature Access, so without it "vendor-only"
would last exactly until a company admin flipped one row. A rank floor cannot
express it either — a vendor sits BELOW every staff role, so a floor of `vendor`
would admit the entire company.

Staff keep `jobs.view`. They work tickets; they no longer raise them.

What each role SEES is narrowed in the service, and the two rules are different
in kind: staff see by GEOGRAPHY (their territory's pincodes), a vendor sees by
OWNERSHIP (tickets against its own brand), and a vendor USER sees only the ones
they raised themselves. Applied on the list and on fetch-by-id alike, so a
guessed id reads as 404 rather than a 403 that would confirm it exists.

Filters are matched case-insensitively and an unknown value yields an empty page
rather than a 422 — the lesson from the vendor list, where a stale bookmark
carrying `?status=Active` blanked the whole screen.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    require_feature,
    require_min_rank,
    require_vendor_principal,
)
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.tickets import service
from app.features.tickets.schemas import (
    AssignRequest,
    BonusRequest,
    DashboardSummaryOut,
    ForceCloseRequest,
    NoShowRequest,
    RenotifyOut,
    SerialCorrectionRequest,
    TicketAttachmentOut,
    TicketCreateRequest,
    TicketDetailOut,
    TicketOut,
    TicketProofOut,
)
from app.models.role import AREA_MANAGER

router = APIRouter(prefix="/tickets", tags=["tickets"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("jobs.view"))]
CanCreate = Annotated[Principal, Depends(require_feature("jobs.create"))]
IsVendor = Depends(require_vendor_principal)

#: The escalation surface: the queue and the two ways out of it.
#:
#: BOTH guards, on all three routes, and neither is redundant.
#:
#: `jobs.assign` is the feature key hard rule 2 requires, and the console reads
#: it to decide whether to draw the rail entry — it has been seeded to admin,
#: national head, regional head and area manager since the initial migration and
#: read by nothing until now.
#:
#: `require_min_rank(AREA_MANAGER)` is what makes it stick. A feature grant is
#: deliberately overridable per company through Feature Access, so on the key
#: alone "Area Manager and above" would last exactly until somebody handed
#: `jobs.assign` to Ops Staff — and this is the screen that spends money and
#: commits a person's day. Same pairing, for the same reason, as
#: `vendors/router.py`.
#:
#: The rank floor also refuses vendors for free: a vendor ranks BELOW every
#: staff role, so it can never clear a floor of area manager.
CanAssign = Annotated[Principal, Depends(require_feature("jobs.assign"))]
AreaManagerUp = Depends(require_min_rank(AREA_MANAGER))

#: Ending a job on a manager's authority, without the customer.
#:
#: Its own feature rather than the `jobs.close` that already exists. That key
#: belongs to `admin` and `technician` and to nobody in between, because it
#: means "close your own job" — reusing it would either lock out every manager
#: this screen is FOR, or hand every technician the override that skips the
#: customer.
#:
#: Paired with the rank floor for the same reason the escalation surface is: the
#: feature grant is overridable per company on Feature Access, and this one ends
#: a job the customer never agreed was finished.
CanForceClose = Annotated[Principal, Depends(require_feature("jobs.force_close"))]


@router.get("", response_model=PaginatedEnvelope[TicketOut])
async def list_tickets(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
    slaState: Annotated[str | None, Query()] = None,
    serviceType: Annotated[str | None, Query()] = None,
    technicianId: Annotated[uuid.UUID | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    dateFrom: Annotated[datetime.date | None, Query()] = None,
    dateTo: Annotated[datetime.date | None, Query()] = None,
) -> PaginatedEnvelope[TicketOut]:
    """One page of tickets, most urgent first.

    Sorted by SLA urgency by default rather than by date — the screen exists for
    triage, so the ones already late come first. `?sortBy=createdAt` gives the
    chronological view instead.

    `technicianId` answers "what has this person worked", which is the console's
    technician profile. It needs no guard of its own: the query is already
    company-scoped and territory-scoped, so an id from another company — or from
    outside the reader's own area — narrows to nothing and returns an empty
    page. It cannot be used to discover that a technician exists.
    """
    rows, total = await service.list_tickets(
        db,
        principal,
        params,
        status_filter=status,
        sla_filter=slaState,
        service_type=serviceType,
        technician_id=technicianId,
        region_id=regionId,
        state_id=stateId,
        date_from=dateFrom,
        date_to=dateTo,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/summary", response_model=ApiEnvelope[DashboardSummaryOut])
async def dashboard_summary(
    db: Db,
    principal: CanView,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    dateFrom: Annotated[datetime.date | None, Query()] = None,
    dateTo: Annotated[datetime.date | None, Query()] = None,
) -> ApiEnvelope[DashboardSummaryOut]:
    """Every number the console's dashboard draws, in one round trip.

    Declared ABOVE `/{ticket_id}` for the reason `/escalations` is — Starlette
    matches in declaration order, and the dynamic route would otherwise swallow
    `summary` as a ticket id and answer 422.

    `jobs.view` rather than a rank floor: this is the landing page every staff
    role opens, and the figures are already narrowed to the caller's own
    territory by `scoped()`, so there is nothing here a person who may see the
    ticket list may not see counted. It carries no delta and no forecast — see
    `DashboardSummaryOut` on why a movement chip with no history behind it is
    the one thing that does not ship.

    ## The four filters narrow; none of them can widen

    `regionId` / `stateId` are the console's territory picker — a national head
    drilling from All India into a region, then a state. They need no permission
    check of their own, and deliberately have none: the pincode subquery they
    build is ANDed with `scoped()`, so naming somewhere outside your own
    territory intersects to nothing and reads zero. There is no id here that
    reveals anything, and no second rule to keep in step with the picker.

    `dateFrom` / `dateTo` are IST calendar dates, inclusive at both ends, and
    either may be given alone. They bound INTAKE — when the ticket was raised —
    because every ticket has a `created_at` and only some have a slot; bounding
    on the slot would silently drop every unbooked ticket, which is precisely
    what the "Slot not confirmed" card exists to count.
    """
    return envelope(
        await service.dashboard_summary(
            db,
            principal,
            region_id=regionId,
            state_id=stateId,
            date_from=dateFrom,
            date_to=dateTo,
        )
    )


@router.get(
    "/escalations",
    response_model=PaginatedEnvelope[TicketOut],
    dependencies=[AreaManagerUp],
)
async def list_escalations(
    db: Db,
    principal: CanAssign,
    params: Annotated[ListParams, Depends(list_params)],
    half: Annotated[str | None, Query()] = None,
    slotFrom: Annotated[datetime.date | None, Query()] = None,
    slotTo: Annotated[datetime.date | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    dateFrom: Annotated[datetime.date | None, Query()] = None,
    dateTo: Annotated[datetime.date | None, Query()] = None,
) -> PaginatedEnvelope[TicketOut]:
    """Jobs whose slot is close and that nobody accepted, soonest first.

    Declared ABOVE `/{ticket_id}` — Starlette matches in declaration order, and
    a dynamic route sitting first would swallow this as a ticket id and answer
    422 on a valid request.

    Paged, but not for a pager: the console loads the next page on scroll, so
    every row stays reachable without a page number. The missed half only ever
    grows — see `service.list_escalations` — and it was being sent whole on
    every poll.

    `search` narrows on code, customer, phone, pincode or serial. `half` is
    `live` | `missed` and takes the console's `all` sentinel. `slotFrom` /
    `slotTo` are IST calendar dates bounding the SLOT — the day the work was
    promised, not the day the ticket was raised — inclusive at both ends, and
    either may be given alone.

    Every one of them is applied in SQL rather than in the browser, which on an
    infinite list is the only correct place: filtering the pages that happen to
    be loaded would answer "does this exist?" with "only if you have already
    scrolled far enough".
    """
    rows, total = await service.list_escalations(
        db,
        principal,
        params,
        half=half,
        slot_from=slotFrom,
        slot_to=slotTo,
        # The dashboard's four, so its "Escalations" card opens a queue holding
        # exactly what it counted. `dateFrom`/`dateTo` bound INTAKE and are a
        # different question from `slotFrom`/`slotTo` above, which bound the day
        # the work was promised — both may be set, and they compose.
        region_id=regionId,
        state_id=stateId,
        date_from=dateFrom,
        date_to=dateTo,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/{ticket_id}/assign",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def assign_ticket(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanAssign,
    body: AssignRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """Hand the job to a named technician — §7's last resort.

    **409 says which kind of "no" it is**, and the console has to act on the
    difference: `TICKET_NOT_ASSIGNABLE`, `NO_SLOT`, `TECHNICIAN_SUSPENDED`,
    `TECHNICIAN_INELIGIBLE` (naming the pincode or the certification),
    `DAILY_CAP_REACHED`, or `ALREADY_ASSIGNED` when somebody moved the ticket
    first. A bare 409 would send a manager back to a shortlist to make the same
    unmakeable choice again.

    A technician id from another company reads 404 — a 403 would confirm they
    exist.
    """
    data = await service.assign_technician(
        db, principal, ticket_id, technician_id=body.technicianId
    )
    return envelope(data, message="Technician assigned")


@router.post(
    "/{ticket_id}/bonus",
    response_model=ApiEnvelope[RenotifyOut],
    dependencies=[AreaManagerUp],
)
async def add_bonus(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanAssign,
    body: BonusRequest,
) -> ApiEnvelope[RenotifyOut]:
    """Fund an incentive and put the job back in the pool.

    The slot the customer confirmed does not move — only who is being asked to
    take it, and for how much. `notified` in the response is how many phones
    actually rang, counted with the same predicate the push used; **zero is a
    real answer** and means no bonus can help, because nobody covers this
    pincode for this product with room on that day.

    **409 `NOT_ESCALATED`** means the job is no longer sitting unaccepted —
    almost always because somebody took it while the manager was choosing a
    band, which is the outcome everyone wanted.
    """
    data = await service.add_bonus_and_renotify(
        db, principal, ticket_id, amount_paise=body.amountPaise
    )
    return envelope(data, message="Bonus added and re-notified")


@router.post(
    "/{ticket_id}/no-show",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def record_no_show(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanAssign,
    body: NoShowRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """Confirm that the technician never turned up, and charge them for it.

    The sweep finds these and deliberately charges nothing — a dead phone and a
    deliberate no-show are indistinguishable in the data, and this is the most
    expensive band there is. A person decides; this is where they say so.

    Frees the ticket and moves it to `Escalated`, because the slot has closed
    and it now needs a new time rather than a new technician.

    **409 `NOT_A_NO_SHOW`** — the job started, was cancelled, or somebody moved
    it while the manager was deciding. **409 `SLOT_STILL_OPEN`** — the window
    has not closed yet, so they are late rather than absent.
    """
    return envelope(
        await service.record_no_show(db, principal, ticket_id, note=body.note),
        message="No-show recorded",
    )


@router.post(
    "/{ticket_id}/force-close",
    response_model=ApiEnvelope[TicketDetailOut],
    dependencies=[AreaManagerUp],
)
async def force_close_ticket(
    ticket_id: uuid.UUID,
    db: Db,
    principal: CanForceClose,
    body: ForceCloseRequest,
) -> ApiEnvelope[TicketDetailOut]:
    """End a job the normal closure could not finish.

    Only the customer closes a job here, which leaves one hole: a customer who
    never answers. `sweeps.sweep_force_close` finds those and raises a
    notification rather than closing anything — a system that auto-closed on
    silence would be recording an approval nobody gave. This is where a person
    takes that decision, and signs it.

    Reason, notes and at least one attachment are all required. §10 asks for
    supporting documents and a record of who closed it, when and on what basis,
    and the reason is that this is a closure the CUSTOMER never agreed to — the
    record has to stand on its own the day somebody disputes it.

    Allowed on any live ticket, not only on `Awaiting Customer`: it is the only
    exit from the live set apart from a customer confirming, so a manager who
    cannot use it here has no other tool.

    **409 `ALREADY_SETTLED`** — the ticket is already Closed, Force-Closed or
    Cancelled, including when a colleague settled it while this manager was
    filling the form in.
    """
    return envelope(
        await service.force_close_ticket(db, principal, ticket_id, body),
        message="Ticket force-closed",
    )


@router.get(
    "/{ticket_id}/attachments",
    response_model=ApiEnvelope[list[TicketAttachmentOut]],
)
async def get_ticket_attachments(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[list[TicketAttachmentOut]]:
    """The evidence a manager attached when force-closing this ticket.

    `jobs.view`, not `jobs.force_close`: whoever may look at the ticket may see
    why it was ended. Making the justification harder to read than the closure
    itself would defeat the point of collecting it.
    """
    return envelope(await service.list_attachments(db, principal, ticket_id))


@router.patch("/{ticket_id}/serial", response_model=ApiEnvelope[TicketDetailOut])
async def correct_ticket_serial(
    ticket_id: uuid.UUID, db: Db, principal: CanView, body: SerialCorrectionRequest
) -> ApiEnvelope[TicketDetailOut]:
    """Correct the expected serial — the number taken off the invoice.

    Whoever can see the ticket can fix it, which by the visibility rule means
    staff in its territory and the vendor that raised it. The vendor matters
    most here: the invoice is theirs, so a mistyped serial is theirs to correct.

    Only the EXPECTED serial. What the technician read on site is evidence and
    is not editable, by anyone.
    """
    return envelope(
        await service.correct_serial(
            db,
            principal,
            ticket_id,
            serial_number=body.serialNumber,
            reason=body.reason,
        ),
        message="Serial updated",
    )


@router.get(
    "/{ticket_id}/proof", response_model=ApiEnvelope[list[TicketProofOut]]
)
async def get_ticket_proof(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[list[TicketProofOut]]:
    """What the technician photographed on site.

    Who sees it is decided by the same visibility rule as the ticket itself:
    staff by territory, a vendor by ownership, a vendor user only for tickets
    they raised. A technician gets 404 here — they read their own work through
    `/jobs/{id}/proof`.

    This exists because of escalation. When a customer says the job was not
    finished, the manager picking it up needs to see what was actually
    captured, and until now nothing outside the technician's own phone could.

    Links are signed and expire in minutes; re-read rather than caching them.
    """
    return envelope(await service.list_proof(db, principal, ticket_id))


@router.get("/{ticket_id}", response_model=ApiEnvelope[TicketDetailOut])
async def get_ticket(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[TicketDetailOut]:
    return envelope(await service.get_ticket(db, principal, ticket_id))


@router.post(
    "",
    response_model=ApiEnvelope[TicketOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def create_ticket(
    body: TicketCreateRequest, db: Db, principal: CanCreate
) -> ApiEnvelope[TicketOut]:
    """Raise a ticket by hand — §4's third intake channel.

    A slot decides where it lands: given one, the customer has already agreed a
    time and the ticket is ready for technicians ("New"); without one it waits
    for the customer to pick ("Slot Pending"). The WhatsApp that tells them
    either way is a later slice.
    """
    data = await service.create_ticket(db, principal, body)
    message = (
        "Ticket created"
        if data.slotStart
        else "Ticket created — waiting for the customer to confirm a slot"
    )
    return envelope(data, message=message, status_code=201)
