"""A vendor's own people.

Two guards on every route, and both are load-bearing:

  * `require_feature("vendor.users")` — the key the console reads to decide
    whether to render the screen at all. Held by `vendor`, not `vendor_user`: a
    sub-user raises tickets, it does not create more sub-users.
  * `require_vendor_principal` — a positive assertion that the caller acts for a
    vendor and has one. The feature alone is overridable per company through
    Feature Access, and this is not a preference.

The path parameter is a MEMBERSHIP id, matching `/users`: removing somebody
removes them from this vendor, not from the platform.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
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
from app.features.vendor_users import service
from app.features.vendor_users.schemas import (
    VendorUserCreateRequest,
    VendorUserCreatedOut,
    VendorUserOut,
    VendorUserUpdateRequest,
)

#: Keyed on what happened to the password email. The portal reads
#: `data.emailStatus`; this serves API consumers, Swagger and the logs.
_ADDED_MESSAGE = {
    "sent": "User added — the temporary password has been emailed",
    "skipped": "User added — they sign in with the password they already use",
    "failed": "User added, but the password email did not go out",
}

router = APIRouter(prefix="/vendor/users", tags=["vendor-users"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanManage = Annotated[Principal, Depends(require_feature("vendor.users"))]
IsVendor = Depends(require_vendor_principal)


@router.get(
    "", response_model=PaginatedEnvelope[VendorUserOut], dependencies=[IsVendor]
)
async def list_vendor_users(
    db: Db,
    principal: CanManage,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[VendorUserOut]:
    """This vendor's people, its own account first."""
    rows, total = await service.list_users(db, principal, params)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "",
    response_model=ApiEnvelope[VendorUserCreatedOut],
    status_code=201,
    dependencies=[IsVendor],
)
async def create_vendor_user(
    body: VendorUserCreateRequest, db: Db, principal: CanManage
) -> ApiEnvelope[VendorUserCreatedOut]:
    """Add somebody who can raise tickets for this vendor.

    They see only the tickets they raise themselves; the vendor sees all of
    them. That split is enforced in the ticket service, not here.

    The server mints the temporary password and emails it. **201 even when that
    email fails** — the account exists and the password is in the response, read
    `data.emailStatus` to tell the cases apart.
    """
    row = await service.create_user(db, principal, body)
    return envelope(row, message=_ADDED_MESSAGE[row.emailStatus])


@router.put("/{membership_id}", response_model=ApiEnvelope[VendorUserOut], dependencies=[IsVendor])
async def update_vendor_user(
    membership_id: uuid.UUID,
    body: VendorUserUpdateRequest,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[VendorUserOut]:
    row = await service.update_user(db, principal, membership_id, body)
    return envelope(row, message="User updated")


@router.delete("/{membership_id}", response_model=ApiEnvelope[None], dependencies=[IsVendor])
async def delete_vendor_user(
    membership_id: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[None]:
    await service.delete_user(db, principal, membership_id)
    return envelope(None, message="User removed")
