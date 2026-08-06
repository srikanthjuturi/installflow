"""Company user management — tenant-scoped provisioning of memberships.

Users are created into the ACTIVE company only. Role must sit below the actor's
role (roles never change afterwards). Identity is reused when the email already
exists with the same role (the single-email / multi-company model); a new
identity requires a password. Membership fields (active, manager) are
per-company; identity fields (name, phone, image) are shared across companies.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, ensure_below_rank
from app.core.schemas import ListParams
from app.core.security import hash_password
from app.db.repository import paginate
from app.features.users.schemas import UserCreateRequest, UserOut, UserUpdateRequest
from app.models.membership import Membership
from app.models.role import (
    ROLE_LABELS,
    ROLE_RANKS,
    ROLES_WITHOUT_PROFILE_IMAGE,
    SUPERADMIN,
)
from app.models.user import User


def _user_out(membership: Membership, user: User) -> UserOut:
    return UserOut(
        membershipId=membership.id,
        userId=user.id,
        email=user.email,
        fullName=user.full_name,
        phone=user.phone,
        role=user.role,
        roleLabel=ROLE_LABELS.get(user.role, user.role),
        profileImageUrl=user.profile_image_url,
        isActive=membership.is_active,
        managerId=membership.manager_id,
        createdAt=membership.created_at,
    )


async def _load_membership(
    session: AsyncSession, company_id: uuid.UUID, membership_id: uuid.UUID
) -> tuple[Membership, User]:
    row = (
        await session.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.id == membership_id,
                Membership.company_id == company_id,
                Membership.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return row[0], row[1]


async def _validate_manager(
    session: AsyncSession, company_id: uuid.UUID, manager_id: uuid.UUID
) -> None:
    exists = await session.scalar(
        select(Membership.id).where(
            Membership.id == manager_id,
            Membership.company_id == company_id,
            Membership.deleted_at.is_(None),
        )
    )
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Manager must be a member of this company",
        )


async def list_users(
    session: AsyncSession, principal: Principal, params: ListParams
) -> tuple[list[UserOut], int]:
    stmt = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
        )
    )
    if params.search:
        term = f"%{params.search.lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.email).like(term), func.lower(User.full_name).like(term))
        )
    sort_col = {
        "name": User.full_name,
        "email": User.email,
        "role": User.role,
        "createdAt": Membership.created_at,
    }.get(params.sortBy or "createdAt", Membership.created_at)
    stmt = stmt.order_by(sort_col.desc() if params.sortDir == "desc" else sort_col.asc())

    # paginate() counts over the statement and applies limit/offset.
    total = await session.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    rows = (
        await session.execute(stmt.limit(params.limit).offset((params.page - 1) * params.limit))
    ).all()
    return [_user_out(m, u) for m, u in rows], int(total or 0)


async def create_user(
    session: AsyncSession, principal: Principal, body: UserCreateRequest
) -> UserOut:
    if body.role == SUPERADMIN or body.role not in ROLE_RANKS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    ensure_below_rank(principal, body.role)

    image = None if body.role in ROLES_WITHOUT_PROFILE_IMAGE else body.profileImageUrl

    existing = await session.scalar(
        select(User).where(func.lower(User.email) == str(body.email).lower())
    )
    if existing is not None:
        if existing.deleted_at is not None or existing.role != body.role:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already belongs to another user",
            )
        already = await session.scalar(
            select(Membership.id).where(
                Membership.user_id == existing.id,
                Membership.company_id == principal.company_id,
                Membership.deleted_at.is_(None),
            )
        )
        if already is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this company",
            )
        user = existing
    else:
        if not body.password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password is required for a new user",
            )
        user = User(
            email=str(body.email),
            password_hash=hash_password(body.password),
            full_name=body.fullName,
            phone=body.phone,
            role=body.role,
            profile_image_url=image,
            is_active=True,
            created_by=principal.user_id,
        )
        session.add(user)
        await session.flush()

    if body.managerId is not None:
        await _validate_manager(session, principal.company_id, body.managerId)

    membership = Membership(
        user_id=user.id,
        company_id=principal.company_id,
        manager_id=body.managerId,
        is_active=True,
        created_by=principal.user_id,
    )
    session.add(membership)
    await session.commit()
    await session.refresh(membership)
    await session.refresh(user)
    return _user_out(membership, user)


async def get_user(
    session: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> UserOut:
    membership, user = await _load_membership(session, principal.company_id, membership_id)
    return _user_out(membership, user)


async def update_user(
    session: AsyncSession,
    principal: Principal,
    membership_id: uuid.UUID,
    body: UserUpdateRequest,
) -> UserOut:
    membership, user = await _load_membership(session, principal.company_id, membership_id)
    ensure_below_rank(principal, user.role)  # cannot edit peers or superiors

    if body.fullName is not None:
        user.full_name = body.fullName
    if body.phone is not None:
        user.phone = body.phone
    if body.profileImageUrl is not None and user.role not in ROLES_WITHOUT_PROFILE_IMAGE:
        user.profile_image_url = body.profileImageUrl
    user.updated_by = principal.user_id

    if body.isActive is not None:
        membership.is_active = body.isActive
    if body.managerId is not None:
        if body.managerId == membership.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A user cannot be their own manager",
            )
        await _validate_manager(session, principal.company_id, body.managerId)
        membership.manager_id = body.managerId
    membership.updated_by = principal.user_id

    await session.commit()
    await session.refresh(membership)
    await session.refresh(user)
    return _user_out(membership, user)


async def delete_user(
    session: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> None:
    membership, user = await _load_membership(session, principal.company_id, membership_id)
    ensure_below_rank(principal, user.role)
    membership.deleted_at = datetime.now(timezone.utc)
    membership.is_active = False
    membership.updated_by = principal.user_id
    await session.commit()
