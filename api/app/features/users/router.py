"""Company user endpoints — tenant-scoped, feature-gated, rank-enforced."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
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
from app.features.users import service
from app.features.users.schemas import UserCreateRequest, UserOut, UserUpdateRequest

router = APIRouter(prefix="/users", tags=["users"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=PaginatedEnvelope[UserOut])
async def list_users(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: Annotated[Principal, Depends(require_feature("users.view"))],
) -> PaginatedEnvelope[UserOut]:
    rows, total = await service.list_users(db, principal, params)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post("", response_model=ApiEnvelope[UserOut], status_code=201)
async def create_user(
    body: UserCreateRequest,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.create"))],
) -> ApiEnvelope[UserOut]:
    data = await service.create_user(db, principal, body)
    return envelope(data, message="User created", status_code=201)


@router.get("/{membership_id}", response_model=ApiEnvelope[UserOut])
async def get_user(
    membership_id: uuid.UUID,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.view"))],
) -> ApiEnvelope[UserOut]:
    data = await service.get_user(db, principal, membership_id)
    return envelope(data)


@router.put("/{membership_id}", response_model=ApiEnvelope[UserOut])
async def update_user(
    membership_id: uuid.UUID,
    body: UserUpdateRequest,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.edit"))],
) -> ApiEnvelope[UserOut]:
    data = await service.update_user(db, principal, membership_id, body)
    return envelope(data, message="User updated")


@router.delete("/{membership_id}", response_model=ApiEnvelope[None])
async def delete_user(
    membership_id: uuid.UUID,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.delete"))],
) -> ApiEnvelope[None]:
    await service.delete_user(db, principal, membership_id)
    return envelope(None, message="User removed")
