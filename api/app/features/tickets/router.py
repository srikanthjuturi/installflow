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
from app.core.deps import Principal, require_feature, require_vendor_principal
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
    SerialCorrectionRequest,
    TicketCreateRequest,
    TicketDetailOut,
    TicketOut,
    TicketProofOut,
)

router = APIRouter(prefix="/tickets", tags=["tickets"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("jobs.view"))]
CanCreate = Annotated[Principal, Depends(require_feature("jobs.create"))]
IsVendor = Depends(require_vendor_principal)


@router.get("", response_model=PaginatedEnvelope[TicketOut])
async def list_tickets(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
    slaState: Annotated[str | None, Query()] = None,
    serviceType: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[TicketOut]:
    """One page of tickets, most urgent first.

    Sorted by SLA urgency by default rather than by date — the screen exists for
    triage, so the ones already late come first. `?sortBy=createdAt` gives the
    chronological view instead.
    """
    rows, total = await service.list_tickets(
        db,
        principal,
        params,
        status_filter=status,
        sla_filter=slaState,
        service_type=serviceType,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


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
