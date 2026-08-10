"""Partner invite endpoints — freelancers and franchises."""

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
from app.features.partners import service
from app.features.partners.schemas import InviteCreateRequest, PartnerInviteOut

router = APIRouter(prefix="/partners", tags=["partners"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("partners.view"))]
CanInvite = Annotated[Principal, Depends(require_feature("partners.invite"))]


@router.get("/invites", response_model=PaginatedEnvelope[PartnerInviteOut])
async def list_invites(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    partnerType: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[PartnerInviteOut]:
    rows, total = await service.list_invites(
        db, principal, params, partnerType, status
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post("/invites", response_model=ApiEnvelope[PartnerInviteOut], status_code=201)
async def create_invite(
    body: InviteCreateRequest, db: Db, principal: CanInvite
) -> ApiEnvelope[PartnerInviteOut]:
    data = await service.create_invite(db, principal, body)
    # 201 even when WhatsApp refused: the invite exists and can be retried, and
    # the row carries the reason. `status` is what says whether it went out.
    message = (
        "Invite sent" if data.status == "sent" else "Invite saved, but not delivered"
    )
    return envelope(data, message=message, status_code=201)


@router.post(
    "/invites/{invite_id}/resend", response_model=ApiEnvelope[PartnerInviteOut]
)
async def resend_invite(
    invite_id: uuid.UUID, db: Db, principal: CanInvite
) -> ApiEnvelope[PartnerInviteOut]:
    data = await service.resend_invite(db, principal, invite_id)
    message = "Invite resent" if data.status == "sent" else "Still not delivered"
    return envelope(data, message=message)


@router.delete("/invites/{invite_id}", response_model=ApiEnvelope[None])
async def cancel_invite(
    invite_id: uuid.UUID, db: Db, principal: CanInvite
) -> ApiEnvelope[None]:
    await service.cancel_invite(db, principal, invite_id)
    return envelope(None, message="Invite cancelled")
