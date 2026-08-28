"""A vendor's own people — create, list, edit, remove.

Deliberately NOT the `/users` slice, and deliberately not its feature keys.
`users.view` gates the COMPANY's staff list; a vendor holding it could read
every manager in the tenant. This is a separate surface with `vendor.users`, so
a vendor's key opens a vendor's screen and nothing else.

Every query is scoped THREE ways, and all three are needed:

  * `company_id` — the tenant, as everywhere else;
  * `vendor_id` — the caller's own vendor, so one vendor cannot see another's
    people even inside the same company;
  * role — so a sub-user can never be created as anything but `vendor_user`.

A guessed membership id from another vendor returns 404, not 403, for the same
reason it does everywhere else: a 403 confirms the row exists.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.schemas import EmailStatus, ListParams
from app.core.security import generate_temporary_password, hash_password
from app.core.sessions import revoke_refresh_tokens
from app.emails import send_temporary_password
from app.features.vendor_users.schemas import (
    VendorUserCreateRequest,
    VendorUserCreatedOut,
    VendorUserOut,
    VendorUserUpdateRequest,
)
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import ROLE_LABELS, VENDOR, VENDOR_ROLES, VENDOR_USER
from app.models.user import User


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _to_out(membership: Membership, user: User) -> VendorUserOut:
    return VendorUserOut(
        membershipId=membership.id,
        userId=user.id,
        fullName=user.full_name,
        email=user.email,
        phone=user.phone,
        isActive=membership.is_active and user.is_active,
        isOwner=user.role == VENDOR,
        createdAt=membership.created_at,
    )


def _base(principal: Principal):
    """Every row this vendor may touch — its own account and its own people."""
    return (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == principal.company_id,
            Membership.vendor_id == principal.vendor_id,
            Membership.deleted_at.is_(None),
            User.deleted_at.is_(None),
            User.role.in_(VENDOR_ROLES),
        )
    )


async def _load(
    db: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> tuple[Membership, User]:
    row = (
        await db.execute(_base(principal).where(Membership.id == membership_id))
    ).first()
    if row is None:
        raise _not_found()
    return row[0], row[1]


async def _load_editable(
    db: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> tuple[Membership, User]:
    """A row this vendor may CHANGE — which excludes its own account.

    The vendor's login is created with the vendor and reissued from the Vendors
    screen. Editing it from here would be a second place the same account can be
    changed, and the two would disagree.
    """
    membership, user = await _load(db, principal, membership_id)
    if user.role == VENDOR:
        raise _conflict(
            "This is the vendor's own login — it is managed from the Vendors screen"
        )
    return membership, user


async def list_users(
    db: AsyncSession, principal: Principal, params: ListParams
) -> tuple[list[VendorUserOut], int]:
    stmt = _base(principal)
    if params.search:
        term = f"%{params.search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.full_name).like(term),
                func.lower(User.email).like(term),
            )
        )
    # The vendor's own account first, then its people by name — so whoever is
    # looking finds themselves at the top rather than paging for it.
    stmt = stmt.order_by((User.role == VENDOR).desc(), User.full_name)

    # Not `paginate()`: it returns `session.scalars()`, which collapses a
    # two-entity select to the first entity and loses the User. The same reason
    # `users/service.list_users` counts by hand.
    total = await db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    rows = (
        await db.execute(
            stmt.limit(params.limit).offset((params.page - 1) * params.limit)
        )
    ).all()
    return [_to_out(m, u) for m, u in rows], int(total or 0)


async def create_user(
    db: AsyncSession, principal: Principal, body: VendorUserCreateRequest
) -> VendorUserCreatedOut:
    email = str(body.email)
    existing = await db.scalar(
        select(User).where(
            func.lower(User.email) == email.lower(), User.deleted_at.is_(None)
        )
    )
    if existing is not None:
        # The same three outcomes as creating a vendor, and the same reason for
        # naming which: an address held by staff can NEVER become a vendor
        # account, because `users.role` is immutable and nothing changes it.
        if existing.role not in VENDOR_ROLES:
            raise _conflict(
                f"{email} already signs in as "
                f"{ROLE_LABELS.get(existing.role, existing.role)}. "
                "Use a different address."
            )
        clash = await db.scalar(
            select(Membership.id).where(
                Membership.user_id == existing.id,
                Membership.company_id == principal.company_id,
                Membership.deleted_at.is_(None),
            )
        )
        if clash is not None:
            raise _conflict(f"{email} already has an account here")

    # Stays None when an existing identity is reused: that person already has a
    # password of their own, and `users` is global, so minting a new one would
    # sign them out of every other company they work in.
    temporary_password: str | None = None
    if existing is not None:
        user = existing
    else:
        temporary_password = generate_temporary_password()
        user = User(
            email=email,
            password_hash=hash_password(temporary_password),
            full_name=body.fullName.strip(),
            phone=body.phone,
            # Fixed, never taken from the request. A vendor creates vendor users;
            # there is no other kind of account it could make.
            role=VENDOR_USER,
            is_active=True,
            created_by=principal.user_id,
        )
        db.add(user)
        # autoflush is OFF (hard rule 9) and the membership needs the id.
        await db.flush()

    db.add(
        Membership(
            user_id=user.id,
            company_id=principal.company_id,
            # The caller's own vendor, never a request field.
            vendor_id=principal.vendor_id,
            is_active=True,
            created_by=principal.user_id,
        )
    )
    await db.commit()
    base = await get_user_by_user_id(db, principal, user.id)
    # After the commit — see `users.service.create_user` for why that ordering
    # is the opposite of the technician invite's.
    outcome = await _mail_password(
        db,
        company_id=principal.company_id,
        user=user,
        temporary_password=temporary_password,
    )
    return VendorUserCreatedOut(**base.model_dump(), **outcome)


async def _mail_password(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    user: User,
    temporary_password: str | None,
) -> dict[str, object]:
    """Send the temporary password and report what happened. Never raises."""
    if temporary_password is None:
        return {"emailStatus": "skipped", "emailError": None, "temporaryPassword": None}

    company_name = await db.scalar(select(Company.name).where(Company.id == company_id))
    result = await send_temporary_password(
        to=str(user.email),
        full_name=user.full_name,
        company_name=company_name or "Reliance GreenTech",
        role_label=ROLE_LABELS.get(user.role, user.role),
        temporary_password=temporary_password,
    )
    status_value: EmailStatus = "sent" if result.ok else "failed"
    return {
        "emailStatus": status_value,
        "emailError": None if result.ok else result.error,
        "temporaryPassword": None if result.ok else temporary_password,
    }


async def get_user_by_user_id(
    db: AsyncSession, principal: Principal, user_id: uuid.UUID
) -> VendorUserOut:
    row = (await db.execute(_base(principal).where(User.id == user_id))).first()
    if row is None:
        raise _not_found()
    return _to_out(row[0], row[1])


async def update_user(
    db: AsyncSession,
    principal: Principal,
    membership_id: uuid.UUID,
    body: VendorUserUpdateRequest,
) -> VendorUserOut:
    membership, user = await _load_editable(db, principal, membership_id)

    if body.fullName is not None:
        user.full_name = body.fullName.strip()
    if body.phone is not None:
        user.phone = body.phone
    if body.isActive is not None:
        membership.is_active = body.isActive
        if not body.isActive:
            # Suspending has to end the sessions too, or it means nothing until
            # the refresh token expires seven days later.
            await revoke_refresh_tokens(db, user.id)
    user.updated_by = principal.user_id
    membership.updated_by = principal.user_id

    await db.commit()
    return _to_out(membership, user)


async def delete_user(
    db: AsyncSession, principal: Principal, membership_id: uuid.UUID
) -> None:
    """Remove somebody from this vendor. Their identity is kept.

    Soft-deleting the membership rather than the user, for the same reason the
    company screen does: the person may belong to a vendor elsewhere, and they
    authored ticket history here that must keep its author.
    """
    membership, user = await _load_editable(db, principal, membership_id)

    membership.is_active = False
    membership.deleted_at = datetime.now(timezone.utc)
    membership.updated_by = principal.user_id
    await revoke_refresh_tokens(db, user.id)
    await db.commit()
