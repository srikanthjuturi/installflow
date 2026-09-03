"""Auth business logic: login, password reset, company switching, refresh, me."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.features import effective_features
from app.core.scope import own_scope, scope_label
from app.core.sessions import revoke_refresh_tokens
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_token,
    hash_password,
    password_fingerprint,
    read_password_reset_token,
    verify_password,
)
from app.features.auth.schemas import (
    CompanyOut,
    LoginResponse,
    MeResponse,
    MeStateOut,
    MeUpdateRequest,
    MeVendorOut,
    MembershipOut,
    RefreshResponse,
    RegionOut,
    SwitchCompanyResponse,
    UserOut,
)
from app.features.technicians.schemas import TechnicianSessionOut
from app.integrations import google_identity
from app.integrations.google_identity import GoogleIdentityError
from app.models.company import Company
from app.models.vendor import Vendor
from app.models.membership import Membership
from app.models.role import ROLE_LABELS, SUPERADMIN, TECHNICIAN
from app.models.technician import TechnicianProfile
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


# ─── Issuing a session ─────────────────────────────────────────────────────
async def issue_session(session: AsyncSession, user: User) -> LoginResponse:
    """Everything that happens once we know WHO is signing in.

    Memberships → active company → token pair → persist → commit → the response.
    Extracted because three doors lead here — a password, a technician's one-time
    code, and Google — and the tail was already duplicated between two of them
    before the third existed. `create_access_token` is minted in five places;
    this is the one that decides what a *session* is.

    Commits. The caller owns everything before the identity is established and
    nothing after it.
    """
    memberships = await _active_memberships(session, user)
    active_company_id = _resolve_active_company(user, memberships)

    access = create_access_token(
        user.id, company_id=str(active_company_id) if active_company_id else None
    )
    refresh = await _issue_refresh_token(session, user)
    # Only a real company id, never None over a good pointer. The OTP path used
    # to write it unconditionally, which would lose a technician's company on any
    # sign-in where memberships momentarily resolved empty.
    if active_company_id and user.last_active_company_id != active_company_id:
        user.last_active_company_id = active_company_id

    profile_out = await _technician_profile(session, user, active_company_id)
    await session.commit()

    return LoginResponse(
        user=_user_out(user),
        memberships=[_membership_out(user, m, c) for m, c in memberships],
        activeCompanyId=active_company_id,
        accessToken=access,
        refreshToken=refresh,
        technicianProfile=profile_out,
    )


async def _technician_profile(
    session: AsyncSession, user: User, active_company_id: uuid.UUID | None
) -> TechnicianSessionOut | None:
    """The mobile app's "go straight to Home" signal, or None.

    Gated on the ROLE, so a console sign-in costs no extra query — only a
    technician can have a profile, and only they can reach this by OTP anyway.
    """
    if user.role != TECHNICIAN or active_company_id is None:
        return None

    row = (
        await session.execute(
            select(TechnicianProfile, Membership, User)
            .join(Membership, Membership.id == TechnicianProfile.membership_id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.user_id == user.id,
                TechnicianProfile.company_id == active_company_id,
                Membership.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None:
        return None

    # Imported here rather than at module scope: the technicians slice imports
    # nothing from auth, and doing this at the top would make the two mutually
    # dependent at load time.
    from app.features.technicians.service import (  # noqa: PLC0415
        technician_session,
    )

    return await technician_session(session, *tuple(row))


# ─── Use cases ─────────────────────────────────────────────────────────────
async def login(session: AsyncSession, email: str, password: str) -> LoginResponse:
    user = await session.scalar(
        select(User).where(
            func.lower(User.email) == email.lower(),
            # Filtered IN the query, not merely checked after it. The unique
            # index on lower(email) is PARTIAL on `deleted_at IS NULL`, so a
            # soft-deleted row and a live one may legitimately share an address —
            # and `scalar()` would silently return whichever came first.
            User.deleted_at.is_(None),
        )
    )
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
    )
    if user is None:
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

    return await issue_session(session, user)


#: How a `GoogleIdentityError` becomes an HTTP answer.
#:
#: The two 503s are deliberate: an unconfigured server and an unreachable Google
#: are OUR problem, not the caller's, and the console's transport reads a 401 as
#: "your token expired" and would burn a refresh on it.
_GOOGLE_FAILURES: dict[str, tuple[int, str, str]] = {
    "NOT_CONFIGURED": (
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "GOOGLE_SIGN_IN_UNAVAILABLE",
        "Google sign-in is not configured on this server",
    ),
    "JWKS_UNAVAILABLE": (
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "GOOGLE_UNAVAILABLE",
        "Could not verify with Google just now. Try again, or sign in with your password.",
    ),
    "EXPIRED": (
        status.HTTP_401_UNAUTHORIZED,
        "GOOGLE_TOKEN_EXPIRED",
        "That Google sign-in took too long. Try again.",
    ),
    "UNVERIFIED_EMAIL": (
        status.HTTP_403_FORBIDDEN,
        "GOOGLE_EMAIL_UNVERIFIED",
        "Your Google account's email address is not verified.",
    ),
}

#: Everything else — a bad signature, a wrong audience, an unknown key, a
#: malformed token — is one indistinguishable rejection. Telling them apart
#: helps an attacker and nobody else.
_GOOGLE_REJECTED = (
    status.HTTP_401_UNAUTHORIZED,
    "GOOGLE_TOKEN_REJECTED",
    "Could not verify that Google sign-in.",
)


async def google_login(session: AsyncSession, credential: str) -> LoginResponse:
    """Exchange a verified Google ID token for the session `/auth/login` issues.

    **This never creates an account.** It authenticates an EXISTING, active,
    non-deleted user matched on a Google-verified email address. Anything else
    would let anyone holding a Gmail address mint themselves a tenant account.

    Vendors and vendor portal users are admitted — they are ordinary `users`
    rows with an email and a password, `login()` already admits them, and
    `deps.get_current_principal` re-reads role and membership on every request,
    so a Google-issued token grants exactly what a password-issued one does.
    """
    try:
        identity = await google_identity.verify_id_token(credential)
    except GoogleIdentityError as exc:
        code, machine_code, detail = _GOOGLE_FAILURES.get(exc.code, _GOOGLE_REJECTED)
        raise AppError(status_code=code, code=machine_code, detail=detail) from exc

    user = await session.scalar(
        select(User).where(
            func.lower(User.email) == identity.email,
            User.deleted_at.is_(None),
        )
    )
    # A soft-deleted account is indistinguishable from one that never existed —
    # deliberately, so this cannot be used to probe which addresses are known.
    if user is None:
        raise AppError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="GOOGLE_NO_ACCOUNT",
            detail=(
                "No console account uses that Google address. "
                "Ask your administrator for access."
            ),
        )

    # Technicians authenticate by PHONE. Tested on the role rather than on a
    # missing password hash, because that is the actual reason — and the hash
    # check below stays as a second line so that a technician who is ever given
    # an email cannot turn Google into a password-free door into their account.
    if user.role == TECHNICIAN or user.password_hash is None:
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="GOOGLE_NOT_A_CONSOLE_ACCOUNT",
            detail="This account signs in with a one-time code, not Google.",
        )
    if not user.is_active:
        # Byte-identical to the password path's wording, on purpose.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )

    return await issue_session(session, user)


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

    # `last_active_company_id` is a POINTER, not a permission — it keeps naming a
    # company after that company is suspended or deleted, and nothing here used to
    # look. A refresh therefore minted a fresh 30-minute token for a shut tenant,
    # every 30 minutes, for the seven days the refresh token lived: the console
    # and the app both renew silently on a 401, so nobody ever saw a login screen
    # and the suspension only bit a week late.
    #
    # Re-resolve it against the live set instead. Ending the session is the honest
    # answer rather than quietly switching them to another of their companies: the
    # clients cache the active company alongside the token, so a swapped claim
    # would show one company's data under another's name.
    company_id: uuid.UUID | None = None
    if user.role != SUPERADMIN:
        memberships = await _active_memberships(session, user)
        company_id = _resolve_active_company(user, memberships)
        if user.last_active_company_id is not None and (
            company_id != user.last_active_company_id
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your access to that company has ended. Sign in again.",
            )

    # Rotate: revoke the presented token, issue a fresh pair.
    row.revoked_at = now
    new_refresh = await _issue_refresh_token(session, user)
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
    vendor: MeVendorOut | None = None
    if principal.vendor_id is not None:
        row = await session.scalar(
            select(Vendor).where(
                Vendor.id == principal.vendor_id,
                Vendor.company_id == principal.company_id,
                Vendor.deleted_at.is_(None),
            )
        )
        if row is not None:
            vendor = MeVendorOut(
                id=row.id,
                name=row.name,
                intakeChannels=list(row.intake_channels or []),
            )

    return MeResponse(
        user=_user_out(user),
        activeCompany=_company_out(active_company) if active_company else None,
        role=principal.role,
        features=features,
        memberships=[_membership_out(user, m, c) for m, c in memberships],
        regions=[RegionOut(id=r.id, code=r.code, name=r.name) for r in scope.regions],
        states=[
            MeStateOut(id=s.id, name=s.name, regionId=s.region_id) for s in scope.states
        ],
        scopeLabel=scope_label(principal.role, scope),
        vendor=vendor,
    )


async def change_password(
    session: AsyncSession, principal: Principal, current: str, new: str
) -> LoginResponse:
    """Set a new password, and end every OTHER session.

    Deliberately 400 on a wrong current password, never 401. The console's
    transport treats a 401 as an expired access token: it would burn a refresh
    and replay the request with the same wrong password, so the user would see
    one failure for two attempts.

    Every outstanding refresh token is revoked and a fresh pair issued, so the
    caller stays signed in HERE and is signed out everywhere else — which is the
    point of changing a password when you suspect somebody else has it. The
    30-minute access-token window is the one thing this cannot close.
    """
    user = principal.user
    if user.password_hash is None:
        # A technician: their phone is the credential and there is nothing to
        # change. Saying so beats "incorrect password" for a password they have
        # never had.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account signs in with a one-time code, not a password",
        )
    if not verify_password(current, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if current == new:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password is the same as the current one",
        )

    user.password_hash = hash_password(new)
    user.updated_by = user.id
    await revoke_refresh_tokens(session, user.id)

    memberships = await _active_memberships(session, user)
    access = create_access_token(
        user.id,
        company_id=str(principal.company_id) if principal.company_id else None,
    )
    refresh = await _issue_refresh_token(session, user)
    await session.commit()

    return LoginResponse(
        user=_user_out(user),
        memberships=[_membership_out(user, m, c) for m, c in memberships],
        activeCompanyId=principal.company_id,
        accessToken=access,
        refreshToken=refresh,
    )


# ─── Forgotten password ────────────────────────────────────────────────────
#
# Three steps, and the middle one is the reason there are three rather than two:
# the person is told their code was right at the moment they type it, not after
# they have also chosen a password. `request` and `verify` live in
# `otp_service` beside the technician code they share every rule with; the
# confirm below is here, next to `change_password`, because it is the same act
# reached through a different door.


async def resettable_user(session: AsyncSession, email: str) -> User:
    """The account a password reset may act on, or an honest refusal.

    An unknown address gets a 404 rather than a bland 200. That is the same
    trade `_find_technician_user` makes and it is made for the same reason: the
    privacy-preserving answer leaves a real person who mistyped their own email
    on a code screen no code will ever reach, whose only possible outcome is
    "that code didn't match" forever. Per-address and per-IP throttling is what
    blunts enumeration, and `/auth/google` already answers the same question out
    loud ("No console account uses that Google address").

    Vendor portal users are admitted — they are ordinary `users` rows with an
    email and a password, and `google_login` admits them on the same reasoning.
    So are superadmins, who have no membership and the least help available when
    they are locked out.
    """
    user = await session.scalar(
        select(User).where(
            func.lower(User.email) == email.lower(),
            # Filtered IN the query for the reason `login` spells out: the
            # unique index on lower(email) is PARTIAL on `deleted_at IS NULL`,
            # so a soft-deleted row and a live one may share an address.
            User.deleted_at.is_(None),
        )
    )
    if user is None:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="RESET_NO_ACCOUNT",
            detail="No console account uses that address.",
        )
    # Tested on the role first, because that is the actual reason. The hash
    # check stays as a second line so an account that is somehow passwordless
    # cannot have one minted for it through this door.
    if user.role == TECHNICIAN or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account signs in with a one-time code, not a password.",
        )
    if not user.is_active:
        # Byte-identical to the password and Google paths, on purpose.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )
    return user


async def reset_company_name(session: AsyncSession, user: User) -> str:
    """Whose name the reset email is sent in.

    A parameter rather than the literal "Reliance GreenTech", because one sender
    serves every company on this platform — the same argument
    `send_temporary_password` makes. The company they last worked in is the one
    they will recognise; a superadmin belongs to none, so the sender's own
    display name is the honest fallback rather than an arbitrary tenant's.
    """
    memberships = await _active_memberships(session, user)
    for _membership, company in memberships:
        if company.id == user.last_active_company_id:
            return company.name
    if memberships:
        return memberships[0][1].name
    return settings.ACS_SENDER_NAME


async def confirm_password_reset(
    session: AsyncSession, reset_token: str, new_password: str
) -> LoginResponse:
    """Set the new password and sign them in. Ends every other session.

    They proved the address a moment ago, so a second sign-in form would be a
    step with nothing to do. `issue_session` is the same tail `/login`,
    `/google` and `/otp/verify` all end in.

    A bad token is a 400, never a 401, for the reason `change_password` gives:
    the console's transport reads a 401 as an expired access token, burns a
    refresh on it and replays — so the user would see one failure for two
    attempts, and a 401 from the refresh would sign them out mid-flow.

    Every failure below is the same sentence. Expired, forged, replayed after a
    successful reset, or minted before a manager reissued the password: telling
    them apart helps an attacker and tells an honest user nothing they can act
    on beyond "start again".
    """
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="That reset has expired or has already been used. Start again.",
    )

    claim = read_password_reset_token(reset_token)
    if claim is None:
        raise invalid
    subject, claimed_fingerprint = claim
    try:
        user_id = uuid.UUID(subject)
    except ValueError:
        raise invalid from None

    user = await session.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    if user is None or user.password_hash is None:
        raise invalid
    # What makes the token single-use: it witnesses the hash it was minted
    # against, and the successful reset below replaces that hash.
    if claimed_fingerprint != password_fingerprint(user.password_hash):
        raise invalid
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )
    if verify_password(new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password is the same as the current one",
        )

    user.password_hash = hash_password(new_password)
    user.updated_by = user.id
    # Whoever else held a session on this account no longer does. That is the
    # point of resetting a password you think somebody else knows.
    await revoke_refresh_tokens(session, user.id)

    return await issue_session(session, user)
