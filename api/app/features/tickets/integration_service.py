"""A vendor's CRM raising tickets — the translation layer, and nothing more.

Everything that makes a ticket a ticket (credit, pincode, serial, visit type,
price, franchisee, the customer's message) happens in `service.create_ticket_as`,
the SAME function the vendor portal uses. This module only:

  * finds a repeat — the CRM's reference already has a ticket;
  * turns the vendor's SKU into one of its own products;
  * maps the CRM's field names onto the ticket request, leaving out everything
    the CRM must not decide (franchisee, price, service level);
  * reports the outcome in the CRM's shape.

## A reference is tied to its ticket for ever

A cancelled or closed ticket still owns its reference. Sending it again returns
that ticket as a repeat; to raise the work again the CRM sends a new reference.
`uq_tickets_vendor_external_ref` (unique per vendor, ignoring case) settles a
race, and the loser re-reads the winner.

## After a check-only call

`create_ticket_as` rolls the session back, which expires every loaded object. Only
plain values captured BEFORE the call are used afterwards.
"""

import uuid

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integration_auth import IntegrationContext
from app.core.integration_errors import refusal
from app.features.tickets import service
from app.features.tickets.integration_schemas import (
    IntegrationTicketCreate,
    IntegrationTicketReply,
)
from app.features.tickets.schemas import TicketCreateRequest
from app.models.product import ProductModel
from app.models.ticket import Ticket

#: The ticket request names the visit time `slot*`; the CRM calls it `visit*`.
_FIELD_NAMES = {"slotStart": "visitStart", "slotEnd": "visitEnd"}


def validation_lines(exc: ValidationError) -> list[str]:
    """One `field: reason` line per problem, in the CRM's own field names."""
    lines: list[str] = []
    for e in exc.errors():
        where = ".".join(str(p) for p in e["loc"])
        where = _FIELD_NAMES.get(where, where)
        message = str(e["msg"]).removeprefix("Value error, ")
        lines.append(f"{where}: {message}" if where else message)
    return lines


async def find_by_reference(
    db: AsyncSession, ctx: IntegrationContext, reference: str
) -> Ticket | None:
    return await db.scalar(
        select(Ticket).where(
            Ticket.company_id == ctx.company_id,
            Ticket.vendor_id == ctx.vendor_id,
            Ticket.deleted_at.is_(None),
            func.lower(Ticket.external_ref) == reference.lower(),
        )
    )


async def _repeat_reply(
    db: AsyncSession, ctx: IntegrationContext, ticket: Ticket, *, check_only: bool
) -> tuple[IntegrationTicketReply, uuid.UUID]:
    return (
        IntegrationTicketReply(
            ticketNumber=ticket.code,
            reference=ticket.external_ref or "",
            status=ticket.status,
            repeat=True,
            checkOnly=check_only,
        ),
        ticket.id,
    )


async def _product_for_sku(
    db: AsyncSession, ctx: IntegrationContext, sku: str
) -> ProductModel:
    """The vendor's OWN product with this SKU. Anything else is `UNKNOWN_SKU`.

    Never creates one. The importer submits unpriced products for approval; the
    API refuses, because a CRM has no way to price or approve anything.
    """
    product = await db.scalar(
        select(ProductModel).where(
            ProductModel.company_id == ctx.company_id,
            ProductModel.vendor_id == ctx.vendor_id,
            ProductModel.deleted_at.is_(None),
            func.lower(ProductModel.sku) == sku.strip().lower(),
        )
    )
    if product is None:
        raise refusal("UNKNOWN_SKU")
    return product


def _ticket_request(
    body: IntegrationTicketCreate, product: ProductModel
) -> TicketCreateRequest:
    """The CRM's fields as a hand-typed ticket's. Nothing the CRM must not decide."""
    try:
        return TicketCreateRequest(
            subcategoryId=product.node_id,
            modelId=product.id,
            serviceType=body.serviceType,
            description=body.description,
            serialNumber=body.serialNumber,
            customerName=body.customerName,
            customerPhone=body.customerPhone,
            customerAltPhone=body.customerAltPhone,
            locality=body.locality,
            address=body.address,
            city=body.city,
            state=body.state,
            pincode=body.pincode,
            latitude=body.latitude,
            longitude=body.longitude,
            expectedDate=body.expectedDate,
            # No `serviceLevelHours`: every API ticket gets the standard window.
            slotStart=body.visitStart,
            slotEnd=body.visitEnd,
            isHighPriority=body.isHighPriority,
            extraAmountPaise=body.extraAmountPaise,
            extraAmountNote=body.extraAmountNote,
            purchaseMode=body.purchaseMode,
            purchasePlatformName=body.purchasePlatformName,
        )
    except ValidationError as exc:
        raise refusal("VALIDATION_ERROR", errors=validation_lines(exc)) from None


async def create_for_crm(
    db: AsyncSession, ctx: IntegrationContext, body: IntegrationTicketCreate
) -> tuple[IntegrationTicketReply, uuid.UUID | None, int]:
    """Create (or recognise, or check) one ticket. Returns (reply, ticket id, HTTP status)."""
    reference = body.reference.strip()
    if not reference:
        raise refusal("VALIDATION_ERROR", errors=["reference: must not be blank"])

    # A repeat first, so a retried request costs nothing and changes nothing.
    existing = await find_by_reference(db, ctx, reference)
    if existing is not None:
        reply, ticket_id = await _repeat_reply(
            db, ctx, existing, check_only=body.checkOnly
        )
        return reply, ticket_id, 200

    product = await _product_for_sku(db, ctx, body.sku)
    request = _ticket_request(body, product)

    try:
        created = await service.create_ticket_as(
            db,
            ctx.principal,
            request,
            source="API",
            external_ref=reference,
            created_by=ctx.credential_id,
            actor_kind="system",
            actor_label=f"API ({ctx.vendor_name})",
            check_only=body.checkOnly,
        )
    except IntegrityError:
        # Lost a race on `uq_tickets_vendor_external_ref`: another call with the
        # same reference committed first. Return theirs; make nothing.
        await db.rollback()
        winner = await find_by_reference(db, ctx, reference)
        if winner is None:
            raise
        reply, ticket_id = await _repeat_reply(
            db, ctx, winner, check_only=body.checkOnly
        )
        return reply, ticket_id, 200

    if created is None:  # check-only: every rule passed, nothing was made
        return (
            IntegrationTicketReply(
                reference=reference, checkOnly=True, wouldCreate=True
            ),
            None,
            200,
        )

    return (
        IntegrationTicketReply(
            ticketNumber=created.code,
            reference=reference,
            status=created.status,
        ),
        created.id,
        201,
    )
