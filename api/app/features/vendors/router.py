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

`/channels` and `/options` are declared BEFORE `/{vendor_id}` — otherwise
FastAPI matches the literal against `uuid.UUID` and 422s, the same trap the
technicians router documents for `/invites` and `/me`.
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
    IntakeChannelOut,
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
#: The brand picker on the product model form — see `list_vendor_options`.
CanPickBrand = Annotated[Principal, Depends(require_feature("masters.view"))]
NationalHeadUp = Depends(require_min_rank(NATIONAL_HEAD))


@router.get(
    "", response_model=PaginatedEnvelope[VendorOut], dependencies=[NationalHeadUp]
)
async def list_vendors(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    # Case-insensitive on purpose. These arrive from a shareable query string,
    # and an older bookmark carrying ?status=Active used to 422 the entire list
    # — a whole screen of "Something went wrong" over the case of one letter.
    status: Annotated[str | None, Query(pattern="(?i)^(active|paused)$")] = None,
    channel: Annotated[
        str | None, Query(pattern="(?i)^(api|excel|manual)$")
    ] = None,
) -> PaginatedEnvelope[VendorOut]:
    rows, total = await service.list_vendors(
        db, principal, params, status_filter=status, channel=channel
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/channels",
    response_model=ApiEnvelope[list[IntakeChannelOut]],
    dependencies=[NationalHeadUp],
)
async def list_intake_channels(
    principal: CanView,
) -> ApiEnvelope[list[IntakeChannelOut]]:
    """The three intake channels, and which of them can be picked today.

    Served rather than mirrored in the console so the "coming soon" reason
    lives in one place and the form cannot offer something the API refuses.
    """
    return envelope(service.list_channels())


@router.get("/options", response_model=ApiEnvelope[list[VendorOptionOut]])
async def list_vendor_options(
    db: Db, principal: CanPickBrand
) -> ApiEnvelope[list[VendorOptionOut]]:
    """Brand names for the product model form.

    Gated on `masters.view` and NOT on `vendors.view` or the National Head
    floor, unlike every other route here — its only consumer is the product
    master, and gating it more tightly than the screen that needs it would
    dead-end model editing with "Couldn't load brands" for anyone holding
    `masters.edit` without `vendors.view`.

    No leak either way: this returns id and name only, and `vendorName` is
    already on every model in the catalogue tree that `masters.view` returns.
    The statutory identity, contact and address stay National-Head-only.
    """
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
