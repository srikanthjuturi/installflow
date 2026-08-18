"""Vendor endpoints — the brand master.

Two guards on every route, and they are not redundant:

  * `require_feature("vendors.view" | "vendors.edit")` — hard rule 2, and the
    key the console reads to decide whether to draw the nav item.
  * `require_min_rank(NATIONAL_HEAD)` — the requirement is stated in terms of
    ROLES ("National Head and above"), and feature grants are deliberately
    overridable per company. Without the floor, a company admin could hand
    vendors to a Regional Head by flipping one `company_role_features` row.

Superadmin is refused by both, because each builds on `CompanyPrincipal`: a
platform superadmin holds no membership and no company feature.

`/options` is declared BEFORE `/{vendor_id}` — otherwise FastAPI matches the
literal against `uuid.UUID` and 422s, the same trap the technicians router
documents for `/invites` and `/me`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_min_rank
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.vendors import service
from app.features.vendors.schemas import (
    VendorCreateRequest,
    VendorOptionOut,
    VendorOut,
    VendorUpdateRequest,
)
from app.models.role import NATIONAL_HEAD

router = APIRouter(prefix="/vendors", tags=["vendors"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("vendors.view"))]
CanEdit = Annotated[Principal, Depends(require_feature("vendors.edit"))]
NationalHeadUp = Depends(require_min_rank(NATIONAL_HEAD))


@router.get(
    "", response_model=PaginatedEnvelope[VendorOut], dependencies=[NationalHeadUp]
)
async def list_vendors(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query(pattern="^(active|paused)$")] = None,
) -> PaginatedEnvelope[VendorOut]:
    rows, total = await service.list_vendors(
        db, principal, params, status_filter=status
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/options",
    response_model=ApiEnvelope[list[VendorOptionOut]],
    dependencies=[NationalHeadUp],
)
async def list_vendor_options(
    db: Db, principal: CanView
) -> ApiEnvelope[list[VendorOptionOut]]:
    return envelope(await service.list_options(db, principal))


@router.get(
    "/{vendor_id}", response_model=ApiEnvelope[VendorOut], dependencies=[NationalHeadUp]
)
async def get_vendor(
    vendor_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[VendorOut]:
    return envelope(await service.get_vendor(db, principal, vendor_id))


@router.post(
    "",
    response_model=ApiEnvelope[VendorOut],
    status_code=201,
    dependencies=[NationalHeadUp],
)
async def create_vendor(
    body: VendorCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[VendorOut]:
    data = await service.create_vendor(db, principal, body)
    return envelope(data, message="Vendor added", status_code=201)


@router.put(
    "/{vendor_id}", response_model=ApiEnvelope[VendorOut], dependencies=[NationalHeadUp]
)
async def update_vendor(
    vendor_id: uuid.UUID, body: VendorUpdateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[VendorOut]:
    data = await service.update_vendor(db, principal, vendor_id, body)
    return envelope(data, message="Vendor updated")


@router.delete(
    "/{vendor_id}", response_model=ApiEnvelope[None], dependencies=[NationalHeadUp]
)
async def delete_vendor(
    vendor_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_vendor(db, principal, vendor_id)
    return envelope(None, message="Vendor removed")
