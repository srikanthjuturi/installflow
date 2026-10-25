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
from app.models.company import Company
from app.models.franchisee import Franchisee
from app.models.membership import Membership
from app.models.role import (
    FRANCHISEE_ADMIN,
    FRANCHISE_ROLES,
    ROLE_LABELS,
    ROLE_RANKS,
    SUPERADMIN,
    TECHNICIAN,
    VENDOR_ROLES,
)
from app.models.technician import TechnicianProfile
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
    #: The franchisee this caller acts FOR — set only for FRANCHISE_ROLES, None
    #: for everyone else.
    #:
    #: Read from the membership `get_current_principal` already loads, like
    #: `vendor_id`; never a token claim, for the same reason `vendor_id` is not
    #: one — a franchisee switched off mid-session must not keep a stale pointer
    #: for the life of the access token. A `franchisee_id` on a NON-franchise
    #: membership is ignored and stays None here: it must never narrow or widen
    #: a staff principal.
    franchisee_id: uuid.UUID | None = None

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

    @property
    def is_franchise(self) -> bool:
        """Acts for a franchisee — any of the three franchise roles.

        Tests the set, never rank: a franchisee admin ranks below every staff
        role, so a rank test cannot say "this family and no other".
        """
        return self.role in FRANCHISE_ROLES


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _why_refused(
    db: AsyncSession, company_id: uuid.UUID
) -> str:
    """Why the caller cannot act here — the company, or their membership in it.

    One extra query, on the REFUSAL path only, so it costs nothing in the normal
    case. Worth it there: "no active membership" is simply untrue when a
    superadmin suspended the whole company, and somebody told the wrong reason
    goes looking in the wrong place — they ask an admin to re-add them to a
    company that is not accepting anyone.
    """
    company = await db.scalar(select(Company).where(Company.id == company_id))
    if company is None or company.deleted_at is not None:
        return "This company no longer exists"
    if not company.is_active:
        return "This company is suspended"
    return "No active membership in the selected company"


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
    franchisee_id: uuid.UUID | None = None
    raw_company = payload.get("company_id")
    if raw_company:
        try:
            company_id = uuid.UUID(str(raw_company))
        except (ValueError, TypeError):
            raise _unauthorized("Invalid company in token") from None
        membership = await db.scalar(
            select(Membership)
            .join(Company, Company.id == Membership.company_id)
            .where(
                Membership.user_id == user.id,
                Membership.company_id == company_id,
                Membership.is_active.is_(True),
                Membership.deleted_at.is_(None),
                # The COMPANY has to still be open, not just the membership.
                # Neither suspending nor deleting a company touches its
                # memberships — by design, because suspension is reversible — so
                # without these two the rows stay live and everyone ALREADY
                # signed in kept working in a tenant that had just been shut. The
                # same pair already guards `_active_memberships`, which is why a
                # fresh login was refused while an open session was not.
                Company.is_active.is_(True),
                Company.deleted_at.is_(None),
            )
        )
        if membership is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=await _why_refused(db, company_id),
            )
        # The membership was loaded to prove the caller belongs here; keep the
        # one field the portal needs rather than querying for it again.
        vendor_id = membership.vendor_id
        if user.role in FRANCHISE_ROLES:
            # Corrupt (no franchisee) and closed (removed / switched off) both
            # refuse here, so EVERY endpoint, /auth/me included, says why — the
            # same reason the company-suspended check lives here: a guard deeper
            # in the slice would give the portal an empty page instead of a
            # sentence it can show.
            live = membership.franchisee_id is not None and await db.scalar(
                select(Franchisee.id).where(
                    Franchisee.company_id == company_id, Franchisee.id == membership.franchisee_id,
                    Franchisee.is_active.is_(True), Franchisee.deleted_at.is_(None)))
            if not live:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="This franchisee is no longer active")
            franchisee_id = membership.franchisee_id

    return Principal(
        user=user,
        role=user.role,
        rank=rank,
        is_superadmin=False,
        company_id=company_id,
        vendor_id=vendor_id,
        franchisee_id=franchisee_id,
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


def require_any_feature(*feature_keys: str):
    """`require_feature`, but any ONE of several keys admits the caller.

    For a read that several screens need for different reasons, where demanding
    the key of one of them would lock the others out of their own work.

    `GET /settings/rules` is the case it was written for. Reading the numbers
    this company operates by is not the same permission as opening the
    configuration screen: an Area Manager cannot see Rules configuration and
    should not, but the bonus bands ARE those rules, and the escalation screen
    where they are spent is theirs. Gated on `settings.view` alone, the one role
    the requirement document puts escalations in front of could not read the
    four amounts it is being asked to choose between.

    Deliberately NOT a way to soften a guard in general. Every key listed must
    be one whose holder genuinely needs this data — an OR is a wider grant than
    an AND, and the temptation is to keep appending to it. The WRITE stays on a
    single key.
    """
    if not feature_keys:  # a mistake at a route definition, caught at import
        raise ValueError("require_any_feature needs at least one feature key")

    async def _guard(
        principal: CompanyPrincipal,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Principal:
        features = await effective_features(
            db, role=principal.role, company_id=principal.company_id
        )
        if not any(key in features for key in feature_keys):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing feature: {' or '.join(feature_keys)}",
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


def require_all(*guards):
    """ONE dependency that runs every guard, in order, and returns the Principal.

    The cure for the stacked-`Depends` trap (api/AGENTS.md, hard rule 2):
    `Annotated[Principal, Depends(a), Depends(b)]` keeps only the LAST marker, so
    `a` never runs. Here each guard is its own single-marker PARAMETER of one
    function, which FastAPI does resolve — in parameter order, stopping at the
    first refusal. `Annotated[Principal, Depends(require_all(a, b))]` is then a
    single marker that really means "a, then b".

    Order the guards wall first (`require_staff_principal` /
    `require_franchise_principal`), then the feature, then the rank floor, so an
    unauthorised caller meets a 403 by principal kind before anything else.
    """
    if not 2 <= len(guards) <= 4:
        raise ValueError("require_all takes two to four guards")
    first, second, *rest = guards

    def _principal(guard):
        return Annotated[Principal, Depends(guard)]

    if not rest:

        def _all(a: _principal(first), b: _principal(second)) -> Principal:
            return b

    elif len(rest) == 1:

        def _all(
            a: _principal(first), b: _principal(second), c: _principal(rest[0])
        ) -> Principal:
            return c

    else:

        def _all(
            a: _principal(first),
            b: _principal(second),
            c: _principal(rest[0]),
            d: _principal(rest[1]),
        ) -> Principal:
            return d

    return _all


def require_vendor_principal(principal: CompanyPrincipal) -> Principal:
    """The caller acts FOR a vendor. Not a feature, and not a rank floor.

    Not a feature, because `require_feature` reads the effective set, and any
    company admin can hand a key back through Feature Access — "only a vendor
    raises a ticket" would then last exactly until somebody opened that screen.

    Not `require_min_rank` either, because a vendor sits BELOW every staff role.
    A floor of `vendor` would admit everyone above it, which is the whole of the
    company. Rank cannot express "this role and no other".

    Use it alongside `require_feature`, never instead: the console still reads
    the feature key to decide what to render.
    """
    if principal.role not in VENDOR_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a vendor can raise a ticket",
        )
    if principal.vendor_id is None:
        # A portal account whose membership names no vendor. Both creation paths
        # set it, so this is a corrupt row rather than a permission question —
        # and it must not be read as "no vendor, therefore unrestricted".
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not linked to a vendor",
        )
    return principal


def require_franchise_principal(principal: CompanyPrincipal) -> Principal:
    """The franchisee's own admin — the F7 owner of technicians and money, and
    nobody else.

    Not a feature (Feature Access can hand any key to any role), not a rank
    floor (franchise roles rank below everyone, so a floor would admit the
    company). Use ALONGSIDE require_feature("franchise.*").
    Routes: /franchise/technicians, payouts, pool, settings, statements
    (Tasks 05/06/10/11).

    The index fixes the name; this — franchisee admin ONLY — is what the name
    has to mean, because `FRANCHISE_ROLES = {franchisee_admin} ∪ FACILITY_ROLES`
    would make a "franchise principal" that also admitted the admin of the
    facility roles two names for one set. The money/technician wall has to
    survive a Feature Access toggle, so it rests on the role, exactly as
    `require_vendor_principal` rests on `VENDOR_ROLES`.
    """
    if principal.role != FRANCHISEE_ADMIN:
        raise HTTPException(status_code=403, detail="Only a franchisee admin can do this")
    if principal.franchisee_id is None:
        raise HTTPException(403, detail="This account is not linked to a franchisee")
    return principal


FranchisePrincipal = Annotated[Principal, Depends(require_franchise_principal)]


def require_facility_principal(principal: CompanyPrincipal) -> Principal:
    """Anyone who works for a franchisee: its admin or its facility staff (P6 —
    the admin may do everything a facility admin can).

    Routes: franchise tickets (Task 04), part requests and facility users
    (Task 12), each with its feature key. Deliberately wider than
    `require_franchise_principal` — this is the family test, `Principal.is_
    franchise` in dependency form; narrowing belongs to the feature key and to
    `core.franchise_scope.purpose`.
    """
    if principal.role not in FRANCHISE_ROLES:
        raise HTTPException(403, detail="Not available on this account")
    if principal.franchisee_id is None:
        raise HTTPException(403, detail="This account is not linked to a franchisee")
    return principal


FacilityPrincipal = Annotated[Principal, Depends(require_facility_principal)]


def require_staff_principal(principal: CompanyPrincipal) -> Principal:
    """An ops-console role: not a vendor, not a technician, not franchise staff.
    The mirror of the guards above, and like them a role test rather than a
    feature or a rank.

    Rank cannot express it — technicians, vendors and franchise roles sit below
    every staff role, so a floor that admitted staff would admit them too — and
    a feature cannot either, since `masters.view` and `jobs.view` are
    deliberately granted to vendors so the intake form has a product tree.

    It exists for global search. Anything that reads ACROSS slices at once has to
    satisfy every slice's ownership rule at the same time, and a vendor's rule is
    the awkward one: they hold `jobs.view` and `masters.view`, so a cross-entity
    read would have to re-derive the vendor pinning that `masters.get_tree` and
    `tickets.scoped()` each do their own way. Refusing the role at the door is
    both safer and honest — the vendor portal has no search box, a technician
    searches in the app, and no franchise screen is a search screen: search
    remains staff.
    """
    if (
        principal.role in VENDOR_ROLES
        or principal.role in FRANCHISE_ROLES
        or principal.role == TECHNICIAN
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not available on this account",
        )
    return principal


async def require_technician_principal(
    principal: CompanyPrincipal,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> tuple[Principal, TechnicianProfile]:
    """The caller IS a technician, and here is their profile row.

    Every technician-facing endpoint needs the same two things and neither is on
    the token: `Principal` carries a user id, while `technician_pincodes`,
    `technician_subcategories` and `tickets.technician_id` all key on
    `technician_profiles.id`. Resolving that join per route is three chances to
    forget `Membership.deleted_at IS NULL` and hand a removed technician a live
    session.

    Not `require_feature`, for the reason `require_vendor_principal` gives: the
    effective set is overridable per company through Feature Access, so "is a
    technician" would last until somebody opened that screen. Use it ALONGSIDE
    a feature key, never instead — hard rule 2 still wants one on every route.

    Not `require_min_rank` either. Technician is the LOWEST rank, so a floor
    there admits the entire company.
    """
    if principal.role != TECHNICIAN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a technician account"
        )
    profile = await db.scalar(
        select(TechnicianProfile)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .where(
            Membership.user_id == principal.user_id,
            TechnicianProfile.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
        )
    )
    if profile is None:
        # A technician-role account with no profile in this company. Not a
        # permission question — there is nothing here to permit.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Technician profile not found"
        )
    return principal, profile


TechnicianPrincipal = Annotated[
    tuple[Principal, TechnicianProfile], Depends(require_technician_principal)
]


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
