"""The console's API credentials — Admin and National Head, per company.

Guarded by `integrations.manage` (seeded to those two roles). Another company's
vendor or credential answers 404, the same as one that does not exist.

The Client Secret appears in exactly one response: the one that creates (or
replaces) a credential. It is never in the list.
"""

import datetime
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
from app.features.api_credentials import service
from app.features.api_credentials.schemas import (
    ApiCredentialCreatedOut,
    ApiCredentialCreateRequest,
    ApiCredentialOut,
    ApiLogOut,
)

router = APIRouter(prefix="/api-credentials", tags=["api-credentials"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanManage = Annotated[Principal, Depends(require_feature("integrations.manage"))]


@router.get("", response_model=ApiEnvelope[list[ApiCredentialOut]])
async def list_credentials(
    db: Db,
    principal: CanManage,
    vendorId: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiEnvelope[list[ApiCredentialOut]]:
    return envelope(await service.list_credentials(db, principal, vendorId))


@router.post("", response_model=ApiEnvelope[ApiCredentialCreatedOut], status_code=201)
async def create_credential(
    body: ApiCredentialCreateRequest, db: Db, principal: CanManage
) -> ApiEnvelope[ApiCredentialCreatedOut]:
    """Issue a credential. The secret is in THIS response only."""
    return envelope(
        await service.create_credential(db, principal, body),
        message="Credential generated",
        status_code=201,
    )


@router.post(
    "/{credential_id}/replace",
    response_model=ApiEnvelope[ApiCredentialCreatedOut],
    status_code=201,
)
async def replace_credential(
    credential_id: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[ApiCredentialCreatedOut]:
    """A NEW credential for the same vendor. The old one keeps working until revoked."""
    return envelope(
        await service.replace_credential(db, principal, credential_id),
        message="Credential generated",
        status_code=201,
    )


@router.post("/{credential_id}/revoke", response_model=ApiEnvelope[ApiCredentialOut])
async def revoke_credential(
    credential_id: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[ApiCredentialOut]:
    return envelope(
        await service.revoke_credential(db, principal, credential_id),
        message="Credential revoked",
    )


logs_router = APIRouter(prefix="/api-logs", tags=["api-credentials"])
Params = Annotated[ListParams, Depends(list_params)]


@logs_router.get("", response_model=PaginatedEnvelope[ApiLogOut])
async def list_logs(
    db: Db,
    principal: CanManage,
    params: Params,
    vendorId: Annotated[uuid.UUID | None, Query()] = None,
    credentialId: Annotated[uuid.UUID | None, Query()] = None,
    endpoint: Annotated[str | None, Query()] = None,
    outcome: Annotated[str | None, Query(pattern="^(ok|error)$")] = None,
    since: Annotated[datetime.datetime | None, Query(alias="from")] = None,
    until: Annotated[datetime.datetime | None, Query(alias="to")] = None,
) -> PaginatedEnvelope[ApiLogOut]:
    """Every call a CRM made with one of this company's credentials, newest first.

    Calls whose Client ID matched no credential are not here: they belong to no
    company, so they are in the server log only.
    """
    rows, total = await service.list_logs(
        db,
        principal,
        params,
        vendor_id=vendorId,
        credential_id=credentialId,
        endpoint=endpoint,
        outcome=outcome,
        since=since,
        until=until,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)
