"""Vendor service — the brand master, company-scoped.

Every read and write filters on `principal.company_id` and `deleted_at IS NULL`,
fetch-by-id included, so guessing another company's vendor id returns 404 and
not a 403 that would confirm the row exists.

No territory scoping: a brand list is company-wide, not regional. The seniority
restriction lives in the router, not here.

Deleting is soft and refuses to orphan — a vendor that still brands product
models is a 409 naming the count, the same shape masters uses for a subcategory
somebody is certified for.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.schemas import ListParams
from app.db.repository import paginate
from app.features.vendors.schemas import (
    VendorCreateRequest,
    VendorOptionOut,
    VendorOut,
    VendorUpdateRequest,
)
from app.models.product import ProductModel
from app.models.vendor import Vendor

SORTABLE = {
    "name": Vendor.name,
    "city": Vendor.city,
    "contactPerson": Vendor.contact_person,
    "createdAt": Vendor.created_at,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


# ── loaders ───────────────────────────────────────────────────────────────────


async def _load(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> Vendor:
    row = await db.scalar(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.company_id == company_id,
            Vendor.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found()
    return row


# ── uniqueness pre-checks ─────────────────────────────────────────────────────


async def _assert_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(Vendor.id).where(
        Vendor.company_id == company_id,
        Vendor.deleted_at.is_(None),
        func.lower(Vendor.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(Vendor.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"A vendor called {name} already exists")


async def _assert_gst_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    gst_number: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(Vendor.name).where(
        Vendor.company_id == company_id,
        Vendor.deleted_at.is_(None),
        func.lower(Vendor.gst_number) == gst_number.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(Vendor.id != exclude_id)
    clash = await db.scalar(stmt)
    if clash is not None:
        raise _conflict(f"{clash} is already registered under GSTIN {gst_number}")


# ── hydration ─────────────────────────────────────────────────────────────────


async def _model_counts(
    db: AsyncSession, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Live product models per vendor — one grouped query, never N+1."""
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(ProductModel.vendor_id, func.count(ProductModel.id))
        .where(
            ProductModel.vendor_id.in_(vendor_ids),
            ProductModel.deleted_at.is_(None),
        )
        .group_by(ProductModel.vendor_id)
    )
    return {vendor_id: count for vendor_id, count in rows}


def _to_out(row: Vendor, model_count: int) -> VendorOut:
    return VendorOut(
        id=row.id,
        name=row.name,
        gstNumber=row.gst_number,
        cin=row.cin,
        contactPerson=row.contact_person,
        phone=row.phone,
        address=row.address,
        city=row.city,
        state=row.state,
        pincode=row.pincode,
        isActive=row.is_active,
        modelCount=model_count,
        createdAt=row.created_at,
    )


async def _one(db: AsyncSession, row: Vendor) -> VendorOut:
    counts = await _model_counts(db, [row.id])
    return _to_out(row, counts.get(row.id, 0))


# ── read ──────────────────────────────────────────────────────────────────────


def _apply_search(stmt: Select, search: str | None) -> Select:
    if not search:
        return stmt
    term = f"%{search.strip().lower()}%"
    return stmt.where(
        or_(
            func.lower(Vendor.name).like(term),
            func.lower(Vendor.gst_number).like(term),
            func.lower(Vendor.contact_person).like(term),
            func.lower(Vendor.phone).like(term),
            func.lower(Vendor.city).like(term),
        )
    )


async def list_vendors(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    status_filter: str | None = None,
) -> tuple[list[VendorOut], int]:
    stmt = select(Vendor).where(
        Vendor.company_id == principal.company_id,
        Vendor.deleted_at.is_(None),
    )
    stmt = _apply_search(stmt, params.search)
    if status_filter == "active":
        stmt = stmt.where(Vendor.is_active.is_(True))
    elif status_filter == "paused":
        stmt = stmt.where(Vendor.is_active.is_(False))

    column = SORTABLE.get(params.sortBy or "name", Vendor.name)
    stmt = stmt.order_by(column.desc() if params.sortDir == "desc" else column.asc())

    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    counts = await _model_counts(db, [r.id for r in rows])
    return [_to_out(r, counts.get(r.id, 0)) for r in rows], total


async def get_vendor(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID
) -> VendorOut:
    return await _one(db, await _load(db, principal.company_id, vendor_id))


async def list_options(
    db: AsyncSession, principal: Principal
) -> list[VendorOptionOut]:
    """Every selectable brand, unpaginated — the model form needs them all.

    Paused and removed vendors are excluded: this drives a picker for NEW
    attributions, and a paused vendor is precisely one you should stop
    attributing to. Models already branded with it keep their brand.
    """
    rows = await db.scalars(
        select(Vendor)
        .where(
            Vendor.company_id == principal.company_id,
            Vendor.deleted_at.is_(None),
            Vendor.is_active.is_(True),
        )
        .order_by(Vendor.name)
    )
    return [VendorOptionOut(id=r.id, name=r.name) for r in rows]


# ── write ─────────────────────────────────────────────────────────────────────


async def create_vendor(
    db: AsyncSession, principal: Principal, body: VendorCreateRequest
) -> VendorOut:
    company_id = principal.company_id
    name = body.name.strip()
    await _assert_name_free(db, company_id, name)
    await _assert_gst_free(db, company_id, body.gstNumber)

    row = Vendor(
        company_id=company_id,
        name=name,
        gst_number=body.gstNumber,
        cin=body.cin,
        contact_person=body.contactPerson.strip(),
        phone=body.phone,
        address=body.address,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        is_active=body.isActive,
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await _one(db, row)


async def update_vendor(
    db: AsyncSession,
    principal: Principal,
    vendor_id: uuid.UUID,
    body: VendorUpdateRequest,
) -> VendorOut:
    row = await _load(db, principal.company_id, vendor_id)

    if body.name is not None:
        name = body.name.strip()
        await _assert_name_free(db, principal.company_id, name, exclude_id=vendor_id)
        row.name = name
    if body.gstNumber is not None:
        await _assert_gst_free(
            db, principal.company_id, body.gstNumber, exclude_id=vendor_id
        )
        row.gst_number = body.gstNumber
    # The one clearable field: an explicit null means "this vendor has no CIN".
    if "cin" in body.model_fields_set:
        row.cin = body.cin
    if body.contactPerson is not None:
        row.contact_person = body.contactPerson.strip()
    if body.phone is not None:
        row.phone = body.phone
    if body.address is not None:
        row.address = body.address
    if body.city is not None:
        row.city = body.city
    if body.state is not None:
        row.state = body.state
    if body.pincode is not None:
        row.pincode = body.pincode
    if body.isActive is not None:
        row.is_active = body.isActive
    row.updated_by = principal.user_id

    await db.commit()
    return await _one(db, row)


async def delete_vendor(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID
) -> None:
    row = await _load(db, principal.company_id, vendor_id)

    branded = (await _model_counts(db, [vendor_id])).get(vendor_id, 0)
    if branded:
        raise _conflict(
            f"{row.name} is the brand on {branded} product model"
            f"{'' if branded == 1 else 's'}. Reassign them first."
        )

    row.deleted_at = _now()
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()
