"""A franchisee's facility users — create, list, switch, reissue (Task 12, §4.8).

Two doors reach this and slices never import each other (hard rule 4), so the
logic lives here:

  * `/franchise/facility-users` (`features/franchise_portal`) — a franchisee
    admin, or a facility admin for operators, managing THEIR OWN franchisee;
  * `/spare-parts/home-facility-users` (`features/spare_parts`) — the company's
    Admin / National Head managing the HOME franchisee's, and no other
    (owner ruling 2026-10-15, R4: with no Admin/NH fallback a home franchise has
    no parts desk until somebody gives it one, and it has no franchisee admin by
    default to do so).

The CALLER decides which franchisee — the portal reads it off the principal,
the staff door resolves the home server-side — and this module trusts it. Every
query is scoped `company_id` + `franchisee_id` + a facility role, so a
membership id from anywhere else (another franchisee's facility user, a
franchisee admin, a staff member) is **404**.

The account creation is Task 03's `core.franchise_logins` (D18): a generated
temporary password, emailed AFTER commit, **201 even when the email fails** with
the password in the response (`EmailOutcome`).
"""

import uuid
from datetime import datetime
from typing import Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.franchise_logins import (
    create_login,
    login_base,
    mail_password,
    reissue_password,
    set_active,
)
from app.core.phone import Phone
from app.core.schemas import AppModel, EmailOutcome, ListParams
from app.core.spare_parts import can_create_facility_role
from app.models.membership import Membership
from app.models.role import FACILITY_ROLES
from app.models.user import User

FacilityRole = Literal["facility_admin", "facility_operator"]


class FacilityUserCreateRequest(BaseModel):
    """`role` is the only choice; the password is the server's. A franchisee
    admin is not a facility role and is refused by the `Literal` (422)."""

    fullName: str = Field(min_length=2, max_length=255)
    email: EmailStr
    #: Required, E.164 — the console-user rule: the only way to reach somebody
    #: when the mailbox they sign in with is the thing that has gone wrong.
    phone: Phone
    role: FacilityRole


class FacilityUserUpdateRequest(BaseModel):
    isActive: bool


class FacilityUserOut(AppModel):
    #: The MEMBERSHIP id — what the routes take.
    membershipId: uuid.UUID
    userId: uuid.UUID
    fullName: str | None
    email: str | None
    phone: str | None
    role: FacilityRole
    #: membership.is_active AND user.is_active.
    isActive: bool
    createdAt: datetime


class FacilityUserCreatedOut(FacilityUserOut, EmailOutcome):
    """`POST` and `reissue-password`."""


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def to_out(membership: Membership, user: User) -> FacilityUserOut:
    return FacilityUserOut(
        membershipId=membership.id,
        userId=user.id,
        fullName=user.full_name,
        email=user.email,
        phone=user.phone,
        role=user.role,  # type: ignore[arg-type]  # login_base filters to facility roles
        isActive=membership.is_active and user.is_active,
        createdAt=membership.created_at,
    )


def _created_out(
    membership: Membership,
    user: User,
    *,
    email_status: str,
    email_error: str | None,
    temporary_password: str | None,
) -> FacilityUserCreatedOut:
    return FacilityUserCreatedOut(
        **to_out(membership, user).model_dump(),
        emailStatus=email_status,  # type: ignore[arg-type]
        emailError=email_error,
        # Exactly on failure, so the manager can still hand it over.
        temporaryPassword=None if email_status == "sent" else temporary_password,
    )


async def _load(
    db: AsyncSession,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    membership_id: uuid.UUID,
) -> tuple[Membership, User]:
    row = (
        await db.execute(
            login_base(company_id, franchisee_id, sorted(FACILITY_ROLES)).where(
                Membership.id == membership_id
            )
        )
    ).first()
    if row is None:
        raise _not_found()
    return row[0], row[1]


def _may_manage_target(actor: Principal, target: User) -> None:
    """The rank rule on the TARGET's role, and never yourself (403)."""
    if not can_create_facility_role(actor.role, target.role):
        raise _forbidden("You can only manage roles below your own")
    if actor.user_id == target.id:
        raise _forbidden("You can't change your own account here")


async def list_users(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    params: ListParams,
) -> tuple[list[FacilityUserOut], int]:
    stmt = login_base(company_id, franchisee_id, sorted(FACILITY_ROLES))
    if params.search:
        term = f"%{params.search.strip().lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.full_name).like(term), func.lower(User.email).like(term))
        )
    # Admins first, then by name.
    stmt = stmt.order_by((User.role == "facility_admin").desc(), User.full_name, Membership.id)
    # Not `paginate()`: it returns scalars and would drop the User half.
    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (
        await db.execute(stmt.limit(params.limit).offset((params.page - 1) * params.limit))
    ).all()
    return [to_out(m, u) for m, u in rows], int(total or 0)


async def create_user(
    db: AsyncSession,
    *,
    actor: Principal,
    franchisee_id: uuid.UUID,
    body: FacilityUserCreateRequest,
) -> FacilityUserCreatedOut:
    assert actor.company_id is not None
    if not can_create_facility_role(actor.role, body.role):
        raise _forbidden("You can only add roles below your own")
    login = await create_login(
        db,
        company_id=actor.company_id,
        franchisee_id=franchisee_id,
        role=body.role,
        full_name=body.fullName.strip(),
        email=str(body.email),
        phone=body.phone,
        actor_id=actor.user_id,
    )
    await db.commit()
    # AFTER the commit: a failed email must not roll back an account that exists.
    email_status, email_error = await mail_password(
        db,
        company_id=actor.company_id,
        user=login.user,
        temporary_password=login.temporary_password,
    )
    return _created_out(
        login.membership,
        login.user,
        email_status=email_status,
        email_error=email_error,
        temporary_password=login.temporary_password,
    )


async def set_user_active(
    db: AsyncSession,
    *,
    actor: Principal,
    franchisee_id: uuid.UUID,
    membership_id: uuid.UUID,
    active: bool,
) -> FacilityUserOut:
    """Deactivating revokes their refresh tokens; reactivating is the same call
    with `true`. Deactivating the LAST facility user is allowed (it is not R3's
    rule, which is about franchisee admins): `partsEnabled` turns false for the
    franchisee's technicians until somebody reactivates one."""
    assert actor.company_id is not None
    membership, user = await _load(db, actor.company_id, franchisee_id, membership_id)
    _may_manage_target(actor, user)
    await set_active(db, membership=membership, user=user, active=active, actor_id=actor.user_id)
    out = to_out(membership, user)
    await db.commit()
    return out


async def reissue(
    db: AsyncSession,
    *,
    actor: Principal,
    franchisee_id: uuid.UUID,
    membership_id: uuid.UUID,
) -> FacilityUserCreatedOut:
    assert actor.company_id is not None
    membership, user = await _load(db, actor.company_id, franchisee_id, membership_id)
    _may_manage_target(actor, user)
    password = await reissue_password(db, user=user, actor_id=actor.user_id)
    await db.commit()
    email_status, email_error = await mail_password(
        db, company_id=actor.company_id, user=user, temporary_password=password
    )
    return _created_out(
        membership, user, email_status=email_status, email_error=email_error,
        temporary_password=password,
    )


CREATED_MESSAGE = {
    "sent": "Facility user added — the temporary password has been emailed",
    "skipped": "Facility user added — they sign in with the password they already use",
    "failed": "Facility user added, but the password email did not go out",
}

REISSUED_MESSAGE = {
    "sent": "A new temporary password has been emailed",
    "skipped": "Password reset",
    "failed": "Password reset, but the email did not go out",
}
