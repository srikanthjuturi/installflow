"""Franchisee-role accounts — F5 in one file.

The Franchisees screen mints logins for the franchisee's own people (Task 03
wires `franchisee_admin`; Tasks 05/14 add the rest), and it must behave exactly
like `/users` behaves for staff — same identity rules, same temp-password flow,
same message on every outcome — because a franchisee admin IS the staff
experience inside their own franchisee, only narrower (F7).

Core, not a slice, because Tasks 03/05 and later the settings slice both need
it and hard rule 4 forbids slices importing each other.

The rules, once:

* an email is one identity per tenant across ALL roles — "x@y.z already signs
  in as Facility Admin" is the whole story, not a 500 from the unique index;
* a temp password is minted ONLY when a new user row is created and sent ONLY
  after COMMIT never-raises (`users`/`vendor_users` did it this way first);
* the last active admin of a NON-home franchisee is load-bearing — without one
  nobody can approve its technicians' UPI changes or pay its redemptions — so
  `blocks_last_admin` refuses to deactivate them. The home is exempt: company
  staff hold all of the home's authorities forever (F8), and the home's OWN
  admin is redundant by construction.
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import brand
from app.core.schemas import EmailStatus
from app.core.security import generate_temporary_password, hash_password
from app.core.sessions import revoke_refresh_tokens
from app.emails import send_temporary_password
from app.models.company import Company
from app.models.membership import Membership
from app.models.token import RefreshToken
from app.models.role import FRANCHISEE_ADMIN, FRANCHISE_ROLES, ROLE_LABELS
from app.models.user import User


@dataclass
class CreatedLogin:
    """What `create_login` made. `temporary_password` is set only for a brand
    new user row — a reused identity keeps its password (it KNOWS it)."""

    membership: Membership
    user: User
    temporary_password: str | None


def login_base(company_id: uuid.UUID, franchisee_id: uuid.UUID, roles: Sequence[str]) -> Select:
    """SQL, never a list: this franchisee's franchisee-role logins, in the
    shape every admin endpoint starts from. Company + franchisee + role
    filtering all live HERE so every caller inherits the tenancy scoping.
    Activity filters stay OUT — callers decide whether suspended rows show."""
    return (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == company_id,
            Membership.franchisee_id == franchisee_id,
            Membership.deleted_at.is_(None),
            User.deleted_at.is_(None),
            User.role.in_(list(roles)),
        )
    )


def _identity_clash(email: str, role: str) -> HTTPException:
    label = ROLE_LABELS.get(role, role)
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"{email} already signs in as {label}."
        " An account cannot be both — use a different address.",
    )


def _already_here(email: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"{email} already has an account here.",
    )


async def create_login(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    role: str,
    full_name: str | None,
    email: str,
    phone: str | None,
    actor_id: uuid.UUID,
) -> CreatedLogin:
    """One flow for every franchisee-role creation. Flushes, never commits.

    The identity walk, in order: nobody by that email → a new user WITH a
    temporary password (the manager needs it to hand over); same email, another
    role → 409 (an account cannot be both); same role, already a live member of
    THIS company → 409 (duplicate invite adds nothing); same role, no live
    membership here → the user is reused, no password is minted (their password
    is theirs, wherever else in the tenant they sign in), and only the membership
    row is written.
    """
    if role not in FRANCHISE_ROLES:
        raise ValueError(f"role {role!r} is not a franchisee role")
    email = email.strip().lower()

    # `users` is global by email (one identity across the whole tenant), so the
    # lookup is too — company scoping belongs to the membership question below.
    existing = await db.scalar(
        select(User).where(
            func.lower(User.email) == email,
            User.deleted_at.is_(None),
        )
    )
    password: str | None = None
    if existing is None:
        password = generate_temporary_password()
        user = User(
            email=email,
            phone=phone,
            full_name=full_name,
            role=role,
            is_active=True,
            password_hash=hash_password(password),
            created_by=actor_id,
        )
        db.add(user)
        await db.flush()
    elif existing.role != role:
        raise _identity_clash(email, existing.role)
    else:
        live_here = await db.scalar(
            select(Membership.id).where(
                Membership.company_id == company_id,
                Membership.user_id == existing.id,
                Membership.deleted_at.is_(None),
            )
        )
        if live_here is not None:
            raise _already_here(email)
        user = existing

    membership = Membership(
        user_id=user.id,
        company_id=company_id,
        franchisee_id=franchisee_id,
        is_active=True,
        created_by=actor_id,
    )
    db.add(membership)
    await db.flush()
    return CreatedLogin(membership=membership, user=user, temporary_password=password)


async def reissue_password(db: AsyncSession, *, user: User, actor_id: uuid.UUID) -> str:
    """A fresh temporary password for a login that does not have one. Flushes,
    never commits; `mail_password` runs after the caller's commit. 400 when the
    account has no email — a reissue emails, it cannot print."""
    if not user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account has no email address — a temporary password can only be sent by email.",
        )
    password = generate_temporary_password()
    user.password_hash = hash_password(password)
    user.updated_by = actor_id
    await revoke_refresh_tokens(db, user.id)
    return password


async def set_active(
    db: AsyncSession,
    *,
    membership: Membership,
    user: User,
    active: bool,
    actor_id: uuid.UUID,
) -> None:
    """Suspend or restore one login. Flushes, never commits. Suspension also
    kills live refresh tokens — a signed-in admin must not keep working. It is
    the membership that toggles, NEVER `user.is_active`: the same user row may
    hold memberships elsewhere in the tenant, and one franchisee's switch must
    not reach them."""
    membership.is_active = active
    membership.updated_by = actor_id
    if not active:
        await revoke_refresh_tokens(db, user.id)


async def mail_password(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    user: User,
    temporary_password: str | None,
) -> tuple[EmailStatus, str | None]:
    """Send the temp password and report what happened. Never raises; runs
    AFTER the caller's commit — a failed email must not roll back an account
    that exists. The fourth copy of this decision by design: `users`,
    `vendor_users` and `company_admins` keep theirs inline, and this one lives
    in core so the franchisee screen gets the same behaviour without slicing."""
    if temporary_password is None:
        return "skipped", None

    company_name = await db.scalar(select(Company.name).where(Company.id == company_id))
    result = await send_temporary_password(
        to=str(user.email),
        full_name=user.full_name,
        company_name=brand.company_name(company_name),
        role_label=ROLE_LABELS.get(user.role, user.role),
        temporary_password=temporary_password,
    )
    return ("sent" if result.ok else "failed"), (None if result.ok else result.error)


def blocks_last_admin(
    *, is_home: bool, target_is_active: bool, active_admin_count: int
) -> bool:
    """PURE. Does switching THIS admin off leave the franchisee with no active
    admin? Non-home only — the home cannot orphan itself (F8, company staff
    hold its authorities). `active_admin_count` INCLUDES the target."""
    return not is_home and target_is_active and active_admin_count <= 1


async def active_admin_count(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> int:
    """Active admins among this franchisee's logins — `login_base` (which stays
    role-filtered and state-blind) tightened to `franchisee_admin` and live
    rows, for `blocks_last_admin`. Includes the target, always."""
    return await db.scalar(
        login_base(company_id, franchisee_id, [FRANCHISEE_ADMIN])
        .with_only_columns(func.count())
        .select_from(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.is_active.is_(True), User.is_active.is_(True))
        .order_by(None)
    ) or 0


async def last_active(
    db: AsyncSession, user_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, object]:
    """The newest refresh-token write per user — the one signal of "signed in
    recently" that survives password changes and does not need a column of its
    own (`users.list_users` reads the same thing). Users with no token get no
    entry; the caller renders `null`."""
    ids = [u for u in user_ids if u is not None]
    if not ids:
        return {}
    rows = await db.execute(
        select(RefreshToken.user_id, func.max(RefreshToken.created_at))
        .where(RefreshToken.user_id.in_(ids))
        .group_by(RefreshToken.user_id)
    )
    return dict(rows.all())