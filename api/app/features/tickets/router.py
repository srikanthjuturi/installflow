"""Ticket endpoints — manual intake and the list.

Gated on the existing `jobs.view` / `jobs.create` keys, which reach down to Area
Manager by design (`514f0c48297c`: "Extends ticket intake — Manual Entry and
Bulk Upload — down the management chain"). No rank floor: unlike the vendor
master, keying a ticket in is the daily work of the people closest to it.

What each role SEES is narrowed instead, by territory — an Area Manager's list
holds only the pincodes they cover. That runs in the service, on the list and on
fetch-by-id alike, so a guessed id from another area reads as 404.

Filters are matched case-insensitively and an unknown value yields an empty page
rather than a 422 — the lesson from the vendor list, where a stale bookmark
carrying `?status=Active` blanked the whole screen.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature
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
    TicketCreateRequest,
    TicketDetailOut,
    TicketOut,
)

router = APIRouter(prefix="/tickets", tags=["tickets"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("jobs.view"))]
CanCreate = Annotated[Principal, Depends(require_feature("jobs.create"))]


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


@router.get("/{ticket_id}", response_model=ApiEnvelope[TicketDetailOut])
async def get_ticket(
    ticket_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[TicketDetailOut]:
    return envelope(await service.get_ticket(db, principal, ticket_id))


@router.post("", response_model=ApiEnvelope[TicketOut], status_code=201)
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
