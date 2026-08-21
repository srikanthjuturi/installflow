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
    StateOut,
    UserCreateRequest,
    UserOut,
    UserUpdateRequest,
)
from app.models.membership import Membership
from app.models.role import (
    VENDOR_ROLES,
    AREA_MANAGER,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_LABELS,
    ROLE_RANKS,
    ROLES_WITHOUT_PROFILE_IMAGE,
    SUPERADMIN,
    TECHNICIAN,
)
from app.models.territory import MembershipRegion, MembershipState, Region, State
from app.models.user import User


def _region_name(scope: Scope, region_id: uuid.UUID) -> str:
    """An area manager's regions are derived from his states and written in the
    same transaction, so the name is always already in the scope."""
    return next((r.name for r in scope.regions if r.id == region_id), "")


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
        states=[
            StateOut(
                id=s.id,
                name=s.name,
                regionId=s.region_id,
                regionName=_region_name(scope, s.region_id),
            )
            for s in scope.states
        ],
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
    role: str, region_ids: list[uuid.UUID], state_ids: list[uuid.UUID]
) -> None:
    """What territory this role must (and must not) carry.

    An area manager sends states and NOT regions: his regions are derived from
    those states by `_set_scope`. Accepting both would let a client assert a
    region that disagrees with the states it also sent.
    """
    if role == REGIONAL_HEAD:
        if not region_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Select at least one region for a regional head",
            )
        if state_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "A regional head covers whole regions — every state inside "
                    "them comes with it"
                ),
            )
        return

    if role == AREA_MANAGER:
        if not state_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Select at least one state for an area manager",
            )
        if region_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="An area manager's region comes from his states",
            )
        return

    # National head is all-India; nobody else carries territory yet.
    if region_ids or state_ids:
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


async def _resolve_states(
    session: AsyncSession, state_ids: list[uuid.UUID]
) -> list[State]:
    if not state_ids:
        return []
    states = list(
        (await session.scalars(select(State).where(State.id.in_(state_ids)))).all()
    )
    if len(states) != len(set(state_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown state"
        )
    return states


async def _check_assignable(
    session: AsyncSession,
    principal: Principal,
    region_ids: list[uuid.UUID],
    states: list[State],
) -> None:
    """You can only hand out territory you hold yourself.

    All-India roles may assign anything; a regional head may only assign one of
    their own regions, or a state INSIDE one of them. Enforced here, not just
    filtered in the dropdown.
    """
    if principal.role in ALL_INDIA_ROLES:
        return
    wanted = set(region_ids) | {s.region_id for s in states}
    if not wanted:
        return
    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    outside = wanted - own.region_ids
    if outside:
        # Name the offending states where we have them — "forbidden" alone
        # makes the assigner guess which pick was the problem.
        offending = sorted(s.name for s in states if s.region_id in outside)
        detail = (
            f"Outside your regions: {', '.join(offending)}"
            if offending
            else "You can only assign regions within your own"
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def _check_states_free(
    session: AsyncSession,
    company_id: uuid.UUID,
    states: list[State],
    *,
    exclude_membership_id: uuid.UUID | None = None,
) -> None:
    """A state belongs to one area manager per company."""
    if not states:
        return
    by_id = {s.id: s.name for s in states}
    stmt = select(MembershipState.state_id).where(
        MembershipState.company_id == company_id,
        MembershipState.state_id.in_(list(by_id)),
    )
    if exclude_membership_id is not None:
        stmt = stmt.where(MembershipState.membership_id != exclude_membership_id)
    taken = sorted({by_id[sid] for sid in (await session.scalars(stmt)).all()})
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
    states: list[State],
    actor_id: uuid.UUID,
) -> None:
    """Replace this membership's territory. Caller has already validated it.

    For an area manager the regions written here are DERIVED from his states,
    in this same transaction — so everything that already reads
    `membership_regions` (the territory tree, a regional head's visibility)
    keeps working without learning about states.
    """
    await session.execute(
        delete(MembershipRegion).where(
            MembershipRegion.membership_id == membership.id
        )
    )
    await session.execute(
        delete(MembershipState).where(MembershipState.membership_id == membership.id)
    )
    derived = list(dict.fromkeys([*region_ids, *(s.region_id for s in states)]))
    for region_id in derived:  # dedupe, keep order
        session.add(
            MembershipRegion(
                membership_id=membership.id,
                region_id=region_id,
                created_by=actor_id,
            )
        )
    for state in {s.id: s for s in states}.values():
        session.add(
            MembershipState(
                membership_id=membership.id,
                company_id=membership.company_id,
                state_id=state.id,
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
            # Users, Technicians and Vendors are disjoint screens. A technician
            # also has no email, so they would sort and search as a row of
            # blanks here; a vendor account has no territory, so its scope
            # column would be a dash — and, worse, `ensure_below_rank` would let
            # any admin suspend or remove a vendor's login from a screen that
            # never explains what it is.
            User.role.not_in([TECHNICIAN, *VENDOR_ROLES]),
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
    # A technician needs a profile, certifications and coverage, none of which
    # this endpoint can create. One made here would be a membership no
    # technician endpoint can see and no job can be offered to.
    if body.role == TECHNICIAN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboard technicians from the Technicians screen",
        )
    # Same reasoning, different screen: a vendor account needs a `vendor_id` on
    # its membership, which this endpoint has no way to supply. One made here
    # would authenticate, hold `jobs.create`, and have no vendor to raise a
    # ticket against.
    #
    # And the rank check below would NOT catch it — a vendor ranks 6, below
    # every staff role, so an Area Manager "outranks" one and would sail past.
    # Rank cannot express "not this family of roles".
    if body.role in VENDOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vendor accounts are created with the vendor, on the Vendors screen",
        )
    ensure_below_rank(principal, body.role)

    # Territory is validated before anything is written, so a bad scope never
    # leaves a half-created user behind.
    _check_scope_shape(body.role, body.regionIds, body.stateIds)
    await _resolve_regions(session, body.regionIds)
    states = await _resolve_states(session, body.stateIds)
    await _check_assignable(session, principal, body.regionIds, states)
    await _check_states_free(session, principal.company_id, states)

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
        # One membership row per (user, company) — enforced by a UNIQUE — and a
        # removed member keeps their (soft-deleted) row. So look for ANY row:
        # an active one is a conflict, a removed one is revived rather than
        # inserted, which is what makes "remove then add back" work.
        prior = await session.scalar(
            select(Membership).where(
                Membership.user_id == existing.id,
                Membership.company_id == principal.company_id,
            )
        )
        if prior is not None and prior.deleted_at is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this company",
            )
        revived = prior
        user = existing
    else:
        revived = None
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

    if revived is not None:
        # Bring the removed member back rather than inserting a second row.
        membership = revived
        membership.deleted_at = None
        membership.is_active = True
        membership.manager_id = body.managerId
        membership.updated_by = principal.user_id
    else:
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
        states=states,
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
    touches_scope = body.regionIds is not None or body.stateIds is not None
    states: list[State] = []
    region_ids: list[uuid.UUID] = []
    if touches_scope:
        current = await load_scope(session, membership.id)
        # An area manager's regions are derived, so "unchanged regions" means
        # his states' regions — never the stored row, which would then be
        # rewritten from a stale value.
        region_ids = (
            body.regionIds
            if body.regionIds is not None
            else ([] if user.role == AREA_MANAGER else [r.id for r in current.regions])
        )
        state_ids = (
            body.stateIds
            if body.stateIds is not None
            else [s.id for s in current.states]
        )
        _check_scope_shape(user.role, region_ids, state_ids)
        await _resolve_regions(session, region_ids)
        states = await _resolve_states(session, state_ids)
        await _check_assignable(session, principal, region_ids, states)
        await _check_states_free(
            session,
            principal.company_id,
            states,
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
            states=states,
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
    # the states for whoever takes over the area.
    await session.execute(
        delete(MembershipRegion).where(MembershipRegion.membership_id == membership.id)
    )
    await session.execute(
        delete(MembershipState).where(MembershipState.membership_id == membership.id)
    )
    await session.commit()
