"""Request principal + authorization guards (shared across all slices).

`get_current_principal` decodes the bearer access token, loads the user (source
of truth for role/active), and — for company-scoped tokens — verifies an active
membership. Guards build on it: superadmin-only, company-required, feature-gated,
and rank-based checks.
"""

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.features import effective_features
from app.core.security import decode_token
from app.models.membership import Membership
from app.models.role import ROLE_LABELS, ROLE_RANKS, SUPERADMIN, VENDOR_ROLES
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    user: User
    role: str
    rank: int
    is_superadmin: bool
    company_id: uuid.UUID | None  # active tenant; None for superadmin
    #: The vendor this caller acts FOR, or None for staff and technicians.
    #:
    #: Read from the membership row this module already loads to prove the
    #: caller still belongs to the company — so it costs no extra query. It is
    #: deliberately NOT a token claim: a vendor removed or paused mid-session
    #: would keep a stale one for the life of the access token, and every other
    #: authorization fact here is re-read per request for the same reason.
    vendor_id: uuid.UUID | None = None

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def is_vendor(self) -> bool:
        """Acts for a vendor — the two portal roles.

        Tests role membership, never rank. A vendor ranks below every staff
        role, which correctly stops a vendor managing staff but does NOT stop an
        Area Manager managing a vendor; only the role answers that.
        """
        return self.role in VENDOR_ROLES


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_principal(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Principal:
    if creds is None:
        raise _unauthorized()
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise _unauthorized("Invalid or expired token") from None
    if payload.get("type") != "access":
        raise _unauthorized("Invalid token type")

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise _unauthorized("Invalid token subject") from None

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active or user.deleted_at is not None:
        raise _unauthorized("User is inactive or no longer exists")

    rank = ROLE_RANKS.get(user.role, max(ROLE_RANKS.values()))

    if user.role == SUPERADMIN:
        return Principal(
            user=user, role=user.role, rank=rank, is_superadmin=True, company_id=None
        )

    company_id: uuid.UUID | None = None
    vendor_id: uuid.UUID | None = None
    raw_company = payload.get("company_id")
    if raw_company:
        try:
            company_id = uuid.UUID(str(raw_company))
        except (ValueError, TypeError):
            raise _unauthorized("Invalid company in token") from None
        membership = await db.scalar(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.company_id == company_id,
                Membership.is_active.is_(True),
                Membership.deleted_at.is_(None),
            )
        )
        if membership is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No active membership in the selected company",
            )
        # The membership was loaded to prove the caller belongs here; keep the
        # one field the portal needs rather than querying for it again.
        vendor_id = membership.vendor_id

    return Principal(
        user=user,
        role=user.role,
        rank=rank,
        is_superadmin=False,
        company_id=company_id,
        vendor_id=vendor_id,
    )


CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]


def require_superadmin(principal: CurrentPrincipal) -> Principal:
    if not principal.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin only"
        )
    return principal


def require_company(principal: CurrentPrincipal) -> Principal:
    """A tenant-scoped principal: a non-superadmin with an active company selected."""
    if principal.is_superadmin or principal.company_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Select a company to access this resource",
        )
    return principal


CompanyPrincipal = Annotated[Principal, Depends(require_company)]


def require_feature(feature_key: str):
    """Dependency factory: 403 unless the principal's effective set has the key."""

    async def _guard(
        principal: CompanyPrincipal,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Principal:
        features = await effective_features(
            db, role=principal.role, company_id=principal.company_id
        )
        if feature_key not in features:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing feature: {feature_key}",
            )
        return principal

    return _guard


def require_min_rank(role_key: str):
    """Dependency factory: a seniority floor a per-company override cannot lift.

    `require_feature` alone is not enough when a requirement is stated in terms
    of ROLES rather than capability. Feature grants are deliberately overridable
    per company through `company_role_features`, so an admin could hand a
    national-head-only screen to a Regional Head by flipping a row. Where the
    rule is "this role and above, full stop", this guard says so in code.

    Use it ALONGSIDE `require_feature`, never instead: hard rule 2 still wants
    every endpoint carrying a feature key, and the console reads that key to
    decide what to render.

    Superadmin is already refused, because this builds on `CompanyPrincipal` —
    they hold no membership and their feature set is only `companies.*`.
    """
    floor = ROLE_RANKS.get(role_key)
    if floor is None:  # a typo in a route definition, caught at import time
        raise ValueError(f"Unknown role: {role_key}")
    label = ROLE_LABELS.get(role_key, role_key)

    def _guard(principal: CompanyPrincipal) -> Principal:
        if principal.rank > floor:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"{label} and above only",
            )
        return principal

    return _guard


def ensure_below_rank(principal: Principal, target_role: str) -> None:
    """Raise 403 unless `target_role` sits strictly below the principal's role."""
    target_rank = ROLE_RANKS.get(target_role)
    if target_rank is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role")
    if target_rank <= principal.rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage roles below your own",
        )
