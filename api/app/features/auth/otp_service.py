"""One-time codes: issuing, throttling and verifying.

Lives inside the auth slice on purpose. Verifying a code has to issue exactly
the token pair `login` issues, so this reuses `_issue_refresh_token`,
`_active_memberships` and `_resolve_active_company` directly rather than
duplicating token logic — and the rule that slices never import each other stays
intact.

Everything here is shared by two callers:
  * technician sign-in            purpose='login',  keyed on a user
  * self-registration             purpose='invite', keyed on an invite
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.features.auth.schemas import LoginResponse, OtpRequestResponse
from app.features.auth.service import (
    _active_memberships,
    _issue_refresh_token,
    _membership_out,
    _resolve_active_company,
    _user_out,
)
from app.integrations.otp_channel import resolve_channel
from app.models.membership import Membership
from app.models.otp import PURPOSE_LOGIN, OtpCode
from app.models.role import TECHNICIAN
from app.models.technician import TechnicianProfile
from app.models.user import User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_code(phone: str, code: str) -> str:
    """sha256 over phone + code + a server-side pepper.

    Not bcrypt: a 6-digit code has 10^6 entropy, so bcrypt at any sane cost is
    still brute-forced offline in seconds. It would buy nothing against the real
    threat while costing ~100 ms on a throttled hot path. The pepper is what
    actually defeats enumeration from a database dump.
    """
    return hashlib.sha256(
        f"{phone}:{code}:{settings.OTP_PEPPER}".encode("utf-8")
    ).hexdigest()


def _generate_code() -> str:
    upper = 10**settings.OTP_LENGTH
    return str(secrets.randbelow(upper)).zfill(settings.OTP_LENGTH)


def _too_many(detail: str, retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(retry_after)},
    )


async def _check_throttles(
    session: AsyncSession, phone: str, request_ip: str | None
) -> None:
    """Three counters, all read from the table so they hold across workers."""
    now = _now()

    last = await session.scalar(
        select(func.max(OtpCode.created_at)).where(OtpCode.phone == phone)
    )
    if last is not None:
        elapsed = (now - last).total_seconds()
        if elapsed < settings.OTP_RESEND_SECONDS:
            wait = int(settings.OTP_RESEND_SECONDS - elapsed) + 1
            raise _too_many(f"Wait {wait}s before requesting another code", wait)

    hour_ago = now - timedelta(hours=1)
    per_phone = await session.scalar(
        select(func.count(OtpCode.id)).where(
            OtpCode.phone == phone, OtpCode.created_at > hour_ago
        )
    )
    if (per_phone or 0) >= settings.OTP_MAX_PER_HOUR:
        raise _too_many("Too many codes requested. Try again in an hour.", 3600)

    if request_ip:
        per_ip = await session.scalar(
            select(func.count(OtpCode.id)).where(
                OtpCode.request_ip == request_ip, OtpCode.created_at > hour_ago
            )
        )
        if (per_ip or 0) >= settings.OTP_MAX_PER_IP_PER_HOUR:
            raise _too_many("Too many codes requested. Try again in an hour.", 3600)


async def issue_code(
    session: AsyncSession,
    *,
    phone: str,
    purpose: str,
    user_id: uuid.UUID | None = None,
    invite_id: uuid.UUID | None = None,
    request_ip: str | None = None,
) -> OtpRequestResponse:
    """Throttle, mint, deliver, record. Commits."""
    await _check_throttles(session, phone, request_ip)

    # Exactly one live code per phone. Without this, "the older message also
    # works" is a permanent source of confused support tickets.
    await session.execute(
        OtpCode.__table__.update()
        .where(OtpCode.phone == phone, OtpCode.consumed_at.is_(None))
        .values(consumed_at=_now())
    )

    code = _generate_code()
    row = OtpCode(
        purpose=purpose,
        phone=phone,
        user_id=user_id,
        invite_id=invite_id,
        code_hash=_hash_code(phone, code),
        expires_at=_now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
    )
    row.request_ip = request_ip
    session.add(row)

    channel = resolve_channel()
    result = await channel.send(phone, code)
    row.sent_channel = channel.name
    row.wa_message_id = result.message_id
    row.wa_error = result.error
    await session.commit()

    # In development the code has to be findable even when a real channel was
    # attempted. The logging channel prints it only when WhatsApp is
    # unconfigured — so the moment credentials exist (and every send is failing
    # or allowlist-blocked) the code would vanish, and nobody could sign in on a
    # phone. OTP_DEV_ECHO already gates this, and startup refuses to boot with
    # it enabled in production.
    if settings.OTP_DEV_ECHO and channel.name != "log":
        logger.warning(
            "OTP for %s is %s (channel=%s, delivered=%s)",
            phone,
            code,
            channel.name,
            result.ok,
        )

    return OtpRequestResponse(
        sent=result.ok,
        channel=channel.name,
        expiresInSeconds=settings.OTP_TTL_SECONDS,
        resendInSeconds=settings.OTP_RESEND_SECONDS,
        devCode=code if settings.OTP_DEV_ECHO else None,
    )


async def consume_code(
    session: AsyncSession, *, phone: str, code: str, purpose: str
) -> OtpCode:
    """Verify and burn a code. Raises 401 on anything that is not a clean match.

    Every failure returns the same message. Distinguishing "expired" from
    "wrong" tells an attacker which half of the guess was right.
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="That code didn't match. Request a new one.",
    )

    row = await session.scalar(
        select(OtpCode)
        .where(
            OtpCode.phone == phone,
            OtpCode.purpose == purpose,
            OtpCode.consumed_at.is_(None),
        )
        .order_by(OtpCode.created_at.desc())
        .limit(1)
    )
    if row is None or row.expires_at <= _now():
        raise invalid

    if row.code_hash != _hash_code(phone, code):
        row.attempts = (row.attempts or 0) + 1
        if row.attempts >= settings.OTP_MAX_ATTEMPTS:
            # Burn it, so the remaining guesses are worthless even if the
            # attacker keeps going.
            row.consumed_at = _now()
        await session.commit()
        if row.attempts >= settings.OTP_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Too many wrong attempts — request a new code",
            )
        raise invalid

    row.consumed_at = _now()
    await session.commit()
    return row


# ── technician sign-in ────────────────────────────────────────────────────────


async def _find_technician_user(session: AsyncSession, phone: str) -> User:
    """Resolve a phone to exactly one live technician identity.

    An unknown number gets a 404 rather than a bland 200. The privacy-preserving
    alternative leaves the caller on an OTP screen no code will ever reach,
    whose only possible outcome is "invalid code" forever. For an app whose
    whole premise is "you must be invited to exist", the honest error is worth
    more than hiding which numbers are technicians; IP throttling blunts
    scraping.
    """
    user = await session.scalar(
        select(User).where(
            User.phone == phone,
            User.role == TECHNICIAN,
            User.deleted_at.is_(None),
        )
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No technician account for this number — ask your manager for an invite",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )
    return user


async def request_login_code(
    session: AsyncSession, phone: str, request_ip: str | None
) -> OtpRequestResponse:
    user = await _find_technician_user(session, phone)
    return await issue_code(
        session,
        phone=phone,
        purpose=PURPOSE_LOGIN,
        user_id=user.id,
        request_ip=request_ip,
    )


async def sign_in(session: AsyncSession, user: User) -> LoginResponse:
    """Issue the same token pair `login` issues, plus the technician profile.

    The access token carries `company_id` — `require_company` 403s without it,
    so every gated technician endpoint would fail otherwise. `/auth/refresh`
    re-derives the company from `last_active_company_id`, so it needs no change
    for technicians.
    """
    memberships = await _active_memberships(session, user)
    active_company_id = _resolve_active_company(user, memberships)

    access = create_access_token(
        user.id, company_id=str(active_company_id) if active_company_id else None
    )
    refresh = await _issue_refresh_token(session, user)
    user.last_active_company_id = active_company_id

    profile_out = None
    if active_company_id is not None:
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
        if row is not None:
            # Imported here rather than at module scope: the technicians slice
            # imports nothing from auth, and doing this at the top would make
            # the two mutually dependent at load time.
            from app.features.technicians.service import (  # noqa: PLC0415
                technician_session,
            )

            profile_out = await technician_session(session, *tuple(row))

    await session.commit()

    return LoginResponse(
        user=_user_out(user),
        memberships=[_membership_out(user, m, c) for m, c in memberships],
        activeCompanyId=active_company_id,
        accessToken=access,
        refreshToken=refresh,
        technicianProfile=profile_out,
    )


async def verify_login_code(
    session: AsyncSession, phone: str, code: str
) -> LoginResponse:
    user = await _find_technician_user(session, phone)
    await consume_code(session, phone=phone, code=code, purpose=PURPOSE_LOGIN)
    return await sign_in(session, user)
