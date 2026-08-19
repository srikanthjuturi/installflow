"""Auth business logic: login, company switching, refresh rotation, logout, me."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import Principal
from app.core.features import effective_features
from app.core.scope import own_scope, scope_label
from app.core.sessions import revoke_refresh_tokens
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_token,
    verify_password,
)
from app.features.auth.schemas import (
    CompanyOut,
    LoginResponse,
    MembershipOut,
    MeResponse,
    MeUpdateRequest,
    RefreshResponse,
    RegionOut,
    SwitchCompanyResponse,
    UserOut,
)
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import ROLE_LABELS, SUPERADMIN
from app.models.token import RefreshToken
from app.models.user import User


# ─── DTO builders ──────────────────────────────────────────────────────────
def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        fullName=user.full_name,
        phone=user.phone,
        role=user.role,
        roleLabel=ROLE_LABELS.get(user.role, user.role),
        profileImageUrl=user.profile_image_url,
        isSuperadmin=user.role == SUPERADMIN,
    )


def _company_out(company: Company) -> CompanyOut:
    return CompanyOut(
        id=company.id,
        name=company.name,
        slug=company.slug,
        email=company.email,
        phone=company.phone,
        isActive=company.is_active,
    )


async def _active_memberships(
    session: AsyncSession, user: User
) -> list[tuple[Membership, Company]]:
    """Active, non-deleted memberships in active, non-deleted companies."""
    if user.role == SUPERADMIN:
        return []
    stmt = (
        select(Membership, Company)
        .join(Company, Company.id == Membership.company_id)
        .where(
            Membership.user_id == user.id,
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
            Company.is_active.is_(True),
            Company.deleted_at.is_(None),
        )
        .order_by(Company.name)
    )
    return list((await session.execute(stmt)).all())


def _membership_out(user: User, membership: Membership, company: Company) -> MembershipOut:
    return MembershipOut(
        companyId=company.id,
        companyName=company.name,
        companySlug=company.slug,
        role=user.role,
        isActive=membership.is_active,
    )


def _resolve_active_company(
    user: User, memberships: list[tuple[Membership, Company]]
) -> uuid.UUID | None:
    if not memberships:
        return None
    company_ids = {c.id for _m, c in memberships}
    if user.last_active_company_id in company_ids:
        return user.last_active_company_id
    return memberships[0][1].id


async def _issue_refresh_token(
    session: AsyncSession, user: User
) -> str:
    raw = generate_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            created_by=user.id,
        )
    )
    return raw


# ─── Use cases ─────────────────────────────────────────────────────────────
async def login(session: AsyncSession, email: str, password: str) -> LoginResponse:
    user = await session.scalar(
        select(User).where(func.lower(User.email) == email.lower())
    )
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
    )
    if user is None or user.deleted_at is not None:
        raise invalid
    # A technician has no password at all — they sign in with a phone and a
    # one-time code. Without this guard `verify_password` calls .encode() on
    # None and the catch-all handler turns an ordinary wrong-account attempt
    # into a 500.
    if user.password_hash is None:
        raise invalid
    if not verify_password(password, user.password_hash):
        raise invalid
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )

    memberships = await _active_memberships(session, user)
    active_company_id = _resolve_active_company(user, memberships)

    access = create_access_token(
        user.id, company_id=str(active_company_id) if active_company_id else None
    )
    refresh = await _issue_refresh_token(session, user)
    if active_company_id and user.last_active_company_id != active_company_id:
        user.last_active_company_id = active_company_id
    await session.commit()

    return LoginResponse(
        user=_user_out(user),
        memberships=[_membership_out(user, m, c) for m, c in memberships],
        activeCompanyId=active_company_id,
        accessToken=access,
        refreshToken=refresh,
    )


async def switch_company(
    session: AsyncSession, principal: Principal, company_id: uuid.UUID
) -> SwitchCompanyResponse:
    if principal.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Superadmin is not scoped to a company",
        )
    membership = await session.scalar(
        select(Membership)
        .join(Company, Company.id == Membership.company_id)
        .where(
            Membership.user_id == principal.user_id,
            Membership.company_id == company_id,
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
            Company.is_active.is_(True),
            Company.deleted_at.is_(None),
        )
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active membership in that company",
        )

    principal.user.last_active_company_id = company_id
    await session.commit()

    access = create_access_token(principal.user_id, company_id=str(company_id))
    return SwitchCompanyResponse(accessToken=access, activeCompanyId=company_id)


async def refresh_tokens(session: AsyncSession, raw_token: str) -> RefreshResponse:
    now = datetime.now(timezone.utc)
    row = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token))
    )
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    user = await session.scalar(select(User).where(User.id == row.user_id))
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive"
        )

    # Rotate: revoke the presented token, issue a fresh pair.
    row.revoked_at = now
    new_refresh = await _issue_refresh_token(session, user)
    company_id = user.last_active_company_id if user.role != SUPERADMIN else None
    access = create_access_token(
        user.id, company_id=str(company_id) if company_id else None
    )
    await session.commit()
    return RefreshResponse(accessToken=access, refreshToken=new_refresh)


async def logout(
    session: AsyncSession, user_id: uuid.UUID, raw_token: str | None
) -> None:
    """One device, or all of them when no token is given.

    The revocation itself lives in `app.core.sessions` — a password change and a
    vendor password reset need exactly the same thing, and hard rule 4 forbids
    them importing it from this slice.
    """
    await revoke_refresh_tokens(session, user_id, raw_token=raw_token)
    await session.commit()


async def update_me(
    session: AsyncSession, principal: Principal, body: MeUpdateRequest
) -> MeResponse:
    """Apply a self-service change and answer with the whole `me` payload.

    Returning `MeResponse` rather than the changed field keeps the client's one
    source of identity truth in one shape — the caller replaces its `me` cache
    instead of patching a copy of it.
    """
    user = principal.user
    if "profileImageUrl" in body.model_fields_set:
        user.profile_image_url = body.profileImageUrl
    await session.commit()
    await session.refresh(user)
    return await get_me(session, principal)


async def get_me(session: AsyncSession, principal: Principal) -> MeResponse:
    user = principal.user
    memberships = await _active_memberships(session, user)
    active_company: Company | None = None
    if principal.company_id is not None:
        active_company = await session.scalar(
            select(Company).where(Company.id == principal.company_id)
        )
    features = await effective_features(
        session, role=principal.role, company_id=principal.company_id
    )
    _own_id, scope = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    return MeResponse(
        user=_user_out(user),
        activeCompany=_company_out(active_company) if active_company else None,
        role=principal.role,
        features=features,
        memberships=[_membership_out(user, m, c) for m, c in memberships],
        regions=[RegionOut(id=r.id, code=r.code, name=r.name) for r in scope.regions],
        pincodes=list(scope.pincodes),
        scopeLabel=scope_label(principal.role, scope),
    )
