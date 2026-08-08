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
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, ensure_below_rank
from app.core.schemas import ListParams
from app.core.scope import (
    ALL_INDIA_ROLES,
    Scope,
    load_scope,
    load_scopes,
    own_scope,
    scope_label,
)
from app.core.security import hash_password
from app.db.repository import territory_scope
from app.features.users.schemas import (
    RegionOut,
    UserCreateRequest,
    UserOut,
    UserUpdateRequest,
)
from app.models.membership import Membership
from app.models.role import (
    AREA_MANAGER,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_LABELS,
    ROLE_RANKS,
    ROLES_WITHOUT_PROFILE_IMAGE,
    SUPERADMIN,
)
from app.models.territory import MembershipPincode, MembershipRegion, Region
from app.models.user import User


def _user_out(membership: Membership, user: User, scope: Scope) -> UserOut:
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
        regions=[
            RegionOut(id=r.id, code=r.code, name=r.name) for r in scope.regions
        ],
        pincodes=list(scope.pincodes),
        scopeLabel=scope_label(user.role, scope),
        createdAt=membership.created_at,
    )


async def _load_membership(
    session: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> tuple[Membership, User]:
    """Fetch one member — inside the caller's company AND their territory.

    Territory-filtered on purpose: a guessed id from another region must read as
    'not found', never as a row the caller isn't entitled to see.
    """
    own_id, scope = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.id == membership_id,
            Membership.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
        )
    )
    stmt = territory_scope(
        stmt, role=principal.role, own_membership_id=own_id, own_scope=scope
    )
    row = (await session.execute(stmt)).first()
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


# ─── territory ─────────────────────────────────────────────────────────────
def _check_scope_shape(
    role: str, region_ids: list[uuid.UUID], pincodes: list[str]
) -> None:
    """What territory this role must (and must not) carry."""
    if role == REGIONAL_HEAD:
        if not region_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Select at least one region for a regional head",
            )
        if pincodes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A regional head covers regions, not pincodes",
            )
        return

    if role == AREA_MANAGER:
        if len(region_ids) != 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Select exactly one region for an area manager",
            )
        if not pincodes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Add at least one pincode for an area manager",
            )
        return

    # National head is all-India; nobody else carries territory yet.
    if region_ids or pincodes:
        detail = (
            "A national head covers all of India"
            if role == NATIONAL_HEAD
            else "This role does not take a territory"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
        )


async def _resolve_regions(
    session: AsyncSession, region_ids: list[uuid.UUID]
) -> list[Region]:
    if not region_ids:
        return []
    regions = list(
        (await session.scalars(select(Region).where(Region.id.in_(region_ids)))).all()
    )
    if len(regions) != len(set(region_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )
    return regions


async def _check_assignable(
    session: AsyncSession, principal: Principal, region_ids: list[uuid.UUID]
) -> None:
    """You can only hand out territory you hold yourself.

    All-India roles may assign any region; a regional head may only assign one
    of their own. Enforced here, not just filtered in the dropdown.
    """
    if principal.role in ALL_INDIA_ROLES or not region_ids:
        return
    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    outside = set(region_ids) - own.region_ids
    if outside:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only assign regions within your own",
        )


async def _check_pincodes_free(
    session: AsyncSession,
    company_id: uuid.UUID,
    pincodes: list[str],
    *,
    exclude_membership_id: uuid.UUID | None = None,
) -> None:
    """A pincode belongs to one area manager per company."""
    if not pincodes:
        return
    stmt = select(MembershipPincode.pincode).where(
        MembershipPincode.company_id == company_id,
        MembershipPincode.pincode.in_(pincodes),
    )
    if exclude_membership_id is not None:
        stmt = stmt.where(MembershipPincode.membership_id != exclude_membership_id)
    taken = sorted(set((await session.scalars(stmt)).all()))
    if taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Already assigned to another area manager: {', '.join(taken)}",
        )


async def _set_scope(
    session: AsyncSession,
    *,
    membership: Membership,
    region_ids: list[uuid.UUID],
    pincodes: list[str],
    actor_id: uuid.UUID,
) -> None:
    """Replace this membership's territory. Caller has already validated it."""
    await session.execute(
        delete(MembershipRegion).where(
            MembershipRegion.membership_id == membership.id
        )
    )
    await session.execute(
        delete(MembershipPincode).where(
            MembershipPincode.membership_id == membership.id
        )
    )
    for region_id in dict.fromkeys(region_ids):  # dedupe, keep order
        session.add(
            MembershipRegion(
                membership_id=membership.id,
                region_id=region_id,
                created_by=actor_id,
            )
        )
    for pincode in dict.fromkeys(pincodes):
        session.add(
            MembershipPincode(
                membership_id=membership.id,
                company_id=membership.company_id,
                pincode=pincode,
                created_by=actor_id,
            )
        )


async def list_users(
    session: AsyncSession, principal: Principal, params: ListParams
) -> tuple[list[UserOut], int]:
    own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
        )
    )
    # A regional head's list simply never contains another region's people.
    stmt = territory_scope(
        stmt, role=principal.role, own_membership_id=own_id, own_scope=own
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
    scopes = await load_scopes(session, [m.id for m, _u in rows])
    return [_user_out(m, u, scopes[m.id]) for m, u in rows], int(total or 0)


async def create_user(
    session: AsyncSession, principal: Principal, body: UserCreateRequest
) -> UserOut:
    if body.role == SUPERADMIN or body.role not in ROLE_RANKS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    ensure_below_rank(principal, body.role)

    # Territory is validated before anything is written, so a bad scope never
    # leaves a half-created user behind.
    _check_scope_shape(body.role, body.regionIds, body.pincodes)
    await _resolve_regions(session, body.regionIds)
    await _check_assignable(session, principal, body.regionIds)
    await _check_pincodes_free(session, principal.company_id, body.pincodes)

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
    await session.flush()  # membership.id, needed by the scope rows
    await _set_scope(
        session,
        membership=membership,
        region_ids=body.regionIds,
        pincodes=body.pincodes,
        actor_id=principal.user_id,
    )
    await session.commit()
    await session.refresh(membership)
    await session.refresh(user)
    scope = await load_scope(session, membership.id)
    return _user_out(membership, user, scope)


async def get_user(
    session: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> UserOut:
    membership, user = await _load_membership(session, principal, membership_id)
    scope = await load_scope(session, membership.id)
    return _user_out(membership, user, scope)


async def update_user(
    session: AsyncSession,
    principal: Principal,
    membership_id: uuid.UUID,
    body: UserUpdateRequest,
) -> UserOut:
    membership, user = await _load_membership(session, principal, membership_id)
    ensure_below_rank(principal, user.role)  # cannot edit peers or superiors

    # Territory: omit both to leave it alone, send a list to replace it.
    touches_scope = body.regionIds is not None or body.pincodes is not None
    if touches_scope:
        current = await load_scope(session, membership.id)
        region_ids = (
            body.regionIds
            if body.regionIds is not None
            else [r.id for r in current.regions]
        )
        pincodes = body.pincodes if body.pincodes is not None else current.pincodes
        _check_scope_shape(user.role, region_ids, pincodes)
        await _resolve_regions(session, region_ids)
        await _check_assignable(session, principal, region_ids)
        await _check_pincodes_free(
            session,
            principal.company_id,
            pincodes,
            exclude_membership_id=membership.id,
        )

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

    if touches_scope:
        await _set_scope(
            session,
            membership=membership,
            region_ids=region_ids,
            pincodes=pincodes,
            actor_id=principal.user_id,
        )

    await session.commit()
    await session.refresh(membership)
    await session.refresh(user)
    scope = await load_scope(session, membership.id)
    return _user_out(membership, user, scope)


async def delete_user(
    session: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> None:
    membership, user = await _load_membership(session, principal, membership_id)
    ensure_below_rank(principal, user.role)
    membership.deleted_at = datetime.now(timezone.utc)
    membership.is_active = False
    membership.updated_by = principal.user_id
    # Scope rows are the CURRENT assignment, not history — dropping them frees
    # the pincodes for whoever takes over the area.
    await session.execute(
        delete(MembershipRegion).where(MembershipRegion.membership_id == membership.id)
    )
    await session.execute(
        delete(MembershipPincode).where(
            MembershipPincode.membership_id == membership.id
        )
    )
    await session.commit()
