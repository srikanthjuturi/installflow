"""The wire shape of one part request, for the facility queue and the ticket page.

In `core/` for the reason `core/spare_parts.py` is: the spare_parts slice (the
facility's queue) and the tickets slice (the ticket page's `partRequests`) both
return it, and slices never import each other (hard rule 4).

D21: it carries **no customer name, phone or address**. A facility needs the job
code, the product, the place (city + pincode) and the technician; data
minimisation costs nothing here.
"""

import datetime
import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.product_label import model_label, vendors_with_several_brands
from app.core.schemas import AppModel
from app.core.spare_parts import allowed_actions
from app.integrations.blob import signed_url
from app.models.franchisee import Franchisee
from app.models.membership import Membership
from app.models.product import ProductModel, ProductNode
from app.models.spare_part import SparePartRequest
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.user import User
from app.models.vendor_brand import VendorBrand


class CatalogueTargetOut(AppModel):
    """Where "Add to <category>'s parts list" would put an Other request."""

    nodeId: uuid.UUID
    nodeName: str


class PartRequestOut(AppModel):
    id: uuid.UUID
    code: str
    status: str
    #: For the console's buttons — `core.spare_parts.allowed_actions`.
    allowedActions: list[str]
    ticketId: uuid.UUID
    ticketCode: str
    ticketStatus: str
    productLabel: str
    city: str
    pincode: str
    franchiseeId: uuid.UUID
    franchiseeName: str
    technicianId: uuid.UUID
    technicianName: str
    technicianPhone: str | None
    sparePartId: uuid.UUID | None
    partName: str
    #: No catalogue row behind it (`spare_part_id IS NULL`): an Other request
    #: still waiting to be linked.
    isOther: bool
    #: Only while an Other request is `requested` — approving it may add the
    #: name to this node's list (P7).
    catalogueTarget: CatalogueTargetOut | None
    note: str | None
    createdAt: datetime.datetime
    decidedAt: datetime.datetime | None
    decidedBy: str | None
    rejectReason: str | None
    #: Owner ruling 2026-10-15 (R2): `rejected` and `rejected_from = 'approved'`.
    rejectedAfterApproval: bool
    issuedAt: datetime.datetime | None
    issuedBy: str | None
    issueNote: str | None
    returnedAt: datetime.datetime | None
    returnedBy: str | None
    returnNote: str | None
    #: Signed per read, 15 minutes; None when there is no photo or no storage.
    returnPhotoUrl: str | None


async def part_request_outs(
    db: AsyncSession, company_id: uuid.UUID, rows: Sequence[SparePartRequest]
) -> list[PartRequestOut]:
    """Shape these requests, in order — a fixed number of queries whatever the
    page size (tickets, products, franchisees, technicians, one node lookup)."""
    if not rows:
        return []

    ticket_ids = {r.ticket_id for r in rows}
    tickets = {
        t.id: t
        for t in await db.scalars(
            select(Ticket).where(Ticket.company_id == company_id, Ticket.id.in_(ticket_ids))
        )
    }

    model_ids = {t.model_id for t in tickets.values()}
    model_rows = (
        await db.execute(
            select(ProductModel.id, ProductModel.name, ProductModel.vendor_id, VendorBrand.name)
            .outerjoin(VendorBrand, VendorBrand.id == ProductModel.brand_id)
            .where(ProductModel.company_id == company_id, ProductModel.id.in_(model_ids))
        )
    ).all()
    several = await vendors_with_several_brands(db, {r[2] for r in model_rows})
    labels = {r[0]: model_label(r[1], r[3], r[2] in several) for r in model_rows}

    franchisees = dict(
        (
            await db.execute(
                select(Franchisee.id, Franchisee.name).where(
                    Franchisee.company_id == company_id,
                    Franchisee.id.in_({r.franchisee_id for r in rows}),
                )
            )
        ).all()
    )

    technicians = {
        r[0]: (r[1], r[2])
        for r in (
            await db.execute(
                select(TechnicianProfile.id, User.full_name, User.phone)
                .join(Membership, Membership.id == TechnicianProfile.membership_id)
                .join(User, User.id == Membership.user_id)
                .where(
                    TechnicianProfile.company_id == company_id,
                    TechnicianProfile.id.in_({r.technician_id for r in rows}),
                )
            )
        ).all()
    }

    # Only an Other request still waiting offers the catalogue target (P7).
    waiting_other = {
        tickets[r.ticket_id].node_id
        for r in rows
        if r.status == "requested" and r.spare_part_id is None and r.ticket_id in tickets
    }
    node_names: dict[uuid.UUID, str] = {}
    if waiting_other:
        node_names = dict(
            (
                await db.execute(
                    select(ProductNode.id, ProductNode.name).where(
                        ProductNode.company_id == company_id,
                        ProductNode.id.in_(waiting_other),
                    )
                )
            ).all()
        )

    prefix = f"attachment/{company_id}/"
    out: list[PartRequestOut] = []
    for r in rows:
        t = tickets.get(r.ticket_id)
        if t is None:  # CASCADE makes this unreachable; never invent a row.
            continue
        name, phone = technicians.get(r.technician_id, (None, None))
        target = None
        if r.status == "requested" and r.spare_part_id is None and t.node_id in node_names:
            target = CatalogueTargetOut(nodeId=t.node_id, nodeName=node_names[t.node_id])
        photo = None
        if r.return_photo_blob_name and r.return_photo_blob_name.startswith(prefix):
            photo = signed_url(r.return_photo_blob_name)
        out.append(
            PartRequestOut(
                id=r.id,
                code=r.code,
                status=r.status,
                allowedActions=allowed_actions(r.status),
                ticketId=t.id,
                ticketCode=t.code,
                ticketStatus=t.status,
                productLabel=labels.get(t.model_id, "—"),
                city=t.city,
                pincode=t.pincode,
                franchiseeId=r.franchisee_id,
                franchiseeName=franchisees.get(r.franchisee_id, "—"),
                technicianId=r.technician_id,
                technicianName=name or "—",
                technicianPhone=phone,
                sparePartId=r.spare_part_id,
                partName=r.part_name,
                isOther=r.spare_part_id is None,
                catalogueTarget=target,
                note=r.note,
                createdAt=r.created_at,
                decidedAt=r.decided_at,
                decidedBy=r.decided_by_label,
                rejectReason=r.reject_reason,
                rejectedAfterApproval=r.status == "rejected" and r.rejected_from == "approved",
                issuedAt=r.issued_at,
                issuedBy=r.issued_by_label,
                issueNote=r.issue_note,
                returnedAt=r.returned_at,
                returnedBy=r.returned_by_label,
                returnNote=r.return_note,
                returnPhotoUrl=photo,
            )
        )
    return out
