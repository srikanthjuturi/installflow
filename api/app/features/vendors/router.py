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
from app.core.gst_lookup import GstinLookupOut, GstinLookupRequest, lookup_gstin_service
from app.features.vendors.schemas import (
    IntakeChannelOut,
    VendorCreateRequest,
    VendorCreatedOut,
    VendorOptionOut,
    VendorOut,
    VendorUpdateRequest,
)
from app.models.role import NATIONAL_HEAD

#: Keyed on what happened to the password email. The console reads
#: `data.emailStatus`; these serve API consumers, Swagger and the logs.
_ADDED_MESSAGE = {
    "sent": "Vendor added — the temporary password has been emailed",
    "skipped": "Vendor added — the login uses the password it already has",
    "failed": "Vendor added, but the password email did not go out",
}

#: Keyed on what the GST registry said. The console reads `data.outcome`; these
#: serve API consumers, Swagger and the logs.
_LOOKUP_MESSAGE = {
    "found": "GSTIN found",
    "not_registered": "That GSTIN is not registered",
    "unavailable": "The GST portal could not be reached",
}

_REISSUED_MESSAGE = {
    "sent": "A new temporary password has been emailed",
    "failed": "Password reset, but the email did not go out",
    "skipped": "Password reset",
}

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


@router.post(
    "/gstin-lookup",
    response_model=ApiEnvelope[GstinLookupOut],
    dependencies=[NationalHeadUp],
)
async def lookup_gstin(
    body: GstinLookupRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[GstinLookupOut]:
    """What the GST registry says about a GSTIN — the vendor form's autofill.

    **Always 200.** `data.outcome` is `found`, `not_registered` (a real answer:
    block the save) or `unavailable` (we could not ask: block nothing). See
    `GstinLookupOut` for why an upstream failure is not an HTTP error here.

    `CanEdit` rather than `CanView`: it reads a public registry, but each call
    spends a unit of a metered subscription, so it belongs behind the people who
    can act on the answer.

    POST rather than GET, despite reading: it matches upstream, keeps a GSTIN
    out of access logs and proxy caches, and cannot be confused with
    `/{vendor_id}`.

    A subscription failure also emails this company's National and Regional
    Heads, at most once a day — nothing else would tell them autofill has
    stopped, since from the screen it looks like a form that has gone quiet.

    The behaviour lives in `app.core.gst_lookup` because the superadmin's
    company form asks the same question of the same registry; only WHO may ask
    differs, and that is what stays here.
    """
    data = await lookup_gstin_service(db, principal.company_id, body.gstin)
    return envelope(data, message=_LOOKUP_MESSAGE[data.outcome])


@router.get(
    "/{vendor_id}", response_model=ApiEnvelope[VendorOut], dependencies=[NationalHeadUp]
)
async def get_vendor(
    vendor_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[VendorOut]:
    return envelope(await service.get_vendor(db, principal, vendor_id))


@router.post(
    "",
    response_model=ApiEnvelope[VendorCreatedOut],
    status_code=201,
    dependencies=[NationalHeadUp],
)
async def create_vendor(
    body: VendorCreateRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[VendorCreatedOut]:
    """Add a vendor and the account that signs in as it.

    The server mints the login's temporary password and emails it. **201 even
    when that email fails** — the vendor exists and the password is in the
    response; read `data.emailStatus` to tell the cases apart.
    """
    data = await service.create_vendor(db, principal, body)
    return envelope(data, message=_ADDED_MESSAGE[data.emailStatus], status_code=201)


@router.post(
    "/{vendor_id}/reissue-password",
    response_model=ApiEnvelope[VendorCreatedOut],
    dependencies=[NationalHeadUp],
)
async def reissue_vendor_password(
    vendor_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[VendorCreatedOut]:
    """Email this vendor's login a fresh temporary password, ending its sessions.

    Takes no body: the password is the server's to choose. Replaces the
    `password` field that used to ride on `PUT /vendors/{id}`.
    """
    data = await service.reissue_login_password(db, principal, vendor_id)
    return envelope(data, message=_REISSUED_MESSAGE[data.emailStatus])


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
