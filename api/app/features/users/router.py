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
from app.features.users.schemas import (
    UserCreateRequest,
    UserCreatedOut,
    UserOut,
    UserUpdateRequest,
)

router = APIRouter(prefix="/users", tags=["users"])

Db = Annotated[AsyncSession, Depends(get_db)]

#: What the caller is told, keyed on what happened to the password email.
#:
#: This duplicates what the console reads from `data.emailStatus`, and the two
#: must be kept saying the same thing — the console cannot see this string at
#: all (`apiPost` returns `data` and drops `message`), so it serves API
#: consumers, Swagger and the logs.
_CREATED_MESSAGE = {
    "sent": "User created — the temporary password has been emailed",
    "skipped": "User added — they sign in with the password they already use",
    "failed": "User created, but the password email did not go out",
}

_REISSUED_MESSAGE = {
    "sent": "A new temporary password has been emailed",
    "failed": "Password reset, but the email did not go out",
    "skipped": "Password reset",
}


@router.get("", response_model=PaginatedEnvelope[UserOut])
async def list_users(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: Annotated[Principal, Depends(require_feature("users.view"))],
) -> PaginatedEnvelope[UserOut]:
    rows, total = await service.list_users(db, principal, params)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post("", response_model=ApiEnvelope[UserCreatedOut], status_code=201)
async def create_user(
    body: UserCreateRequest,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.create"))],
) -> ApiEnvelope[UserCreatedOut]:
    """Create a member. The server mints the password and emails it.

    **201 even when the email fails.** The account exists, and the password is
    in the response for the manager to hand over — a better outcome than a 5xx
    and an identity nobody can sign in as. Read `data.emailStatus` to tell the
    three cases apart.
    """
    data = await service.create_user(db, principal, body)
    return envelope(
        data, message=_CREATED_MESSAGE[data.emailStatus], status_code=201
    )


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


@router.post(
    "/{membership_id}/reissue-password",
    response_model=ApiEnvelope[UserCreatedOut],
)
async def reissue_password(
    membership_id: uuid.UUID,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.edit"))],
) -> ApiEnvelope[UserCreatedOut]:
    """Email this member a fresh temporary password and end their sessions.

    Gated on `users.edit` rather than a key of its own: feature keys are seeded
    by migration, and "may edit this user" is the right authority anyway.

    Takes no body — the password is the server's to choose, which is the whole
    point of the change this endpoint belongs to.
    """
    data = await service.reissue_password(db, principal, membership_id)
    return envelope(data, message=_REISSUED_MESSAGE[data.emailStatus])


@router.delete("/{membership_id}", response_model=ApiEnvelope[None])
async def delete_user(
    membership_id: uuid.UUID,
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("users.delete"))],
) -> ApiEnvelope[None]:
    await service.delete_user(db, principal, membership_id)
    return envelope(None, message="User removed")
