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
    NoShowRequest,
    RenotifyOut,
    SerialCorrectionRequest,
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


@router.get("", response_model=PaginatedEnvelope[TicketOut])
async def list_tickets(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
    slaState: Annotated[str | None, Query()] = None,
    serviceType: Annotated[str | None, Query()] = None,
    technicianId: Annotated[uuid.UUID | None, Query()] = None,
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
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/escalations",
    response_model=PaginatedEnvelope[TicketOut],
    dependencies=[AreaManagerUp],
)
async def list_escalations(
    db: Db,
    principal: CanAssign,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[TicketOut]:
    """Jobs whose slot is close and that nobody accepted, soonest first.

    Declared ABOVE `/{ticket_id}` — Starlette matches in declaration order, and
    a dynamic route sitting first would swallow this as a ticket id and answer
    422 on a valid request.

    Paged, but not for a pager: the console loads the next page on scroll, so
    every row stays reachable without a page number. The missed half only ever
    grows — see `service.list_escalations` — and it was being sent whole on
    every poll.
    """
    rows, total = await service.list_escalations(db, principal, params)
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
