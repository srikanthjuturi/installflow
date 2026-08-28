"""One-time codes: issuing, throttling and verifying.

Lives inside the auth slice on purpose. Verifying a code has to issue exactly
the token pair `login` issues, so `sign_in` delegates to `issue_session` rather
than duplicating token logic — and the rule that slices never import each other
stays intact.

Everything here is shared by three callers:
  * technician sign-in            purpose='login',          phone, keyed on a user
  * self-registration             purpose='invite',         phone, keyed on an invite
  * console password reset        purpose='password_reset',  EMAIL, keyed on a user

A **destination** is a phone or an email, never both. Every function below takes
one as `phone=` or `email=` and the rest of the machine — the pepper, the TTL,
the attempt cap, the three throttle counters, the one-live-code rule — does not
care which arrived. That is the whole reason a password reset does not have a
parallel implementation of its own.
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_password_reset_token
from app.emails import account as account_email
from app.features.auth.schemas import (
    LoginResponse,
    OtpRequestResponse,
    PasswordResetVerifyResponse,
)
from app.features.auth.service import (
    issue_session,
    reset_company_name,
    resettable_user,
)
from app.integrations.otp_channel import resolve_channel
from app.models.otp import PURPOSE_LOGIN, PURPOSE_PASSWORD_RESET, OtpCode
from app.models.role import TECHNICIAN
from app.models.user import User

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _destination(phone: str | None, email: str | None) -> str:
    """The string a code is salted and looked up by. Exactly one, never both."""
    if (phone is None) == (email is None):
        raise ValueError("An OTP needs exactly one of phone or email")
    return phone if phone is not None else (email or "").lower()


def _destination_filter(
    phone: str | None, email: str | None
) -> ColumnElement[bool]:
    """The WHERE clause that selects this destination's codes and no others."""
    if phone is not None:
        return OtpCode.phone == phone
    return OtpCode.email == (email or "").lower()


def _hash_code(destination: str, code: str) -> str:
    """sha256 over destination + code + a server-side pepper.

    Not bcrypt: a 6-digit code has 10^6 entropy, so bcrypt at any sane cost is
    still brute-forced offline in seconds. It would buy nothing against the real
    threat while costing ~100 ms on a throttled hot path. The pepper is what
    actually defeats enumeration from a database dump.

    Salting with the destination is what stops a code minted for one recipient
    verifying for another. An email destination is lowercased before it gets
    here, so the salt cannot change with the casing somebody typed.
    """
    return hashlib.sha256(
        f"{destination}:{code}:{settings.OTP_PEPPER}".encode("utf-8")
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


def _wait_phrase(seconds: int) -> str:
    """`Retry-After` is for the client; this is for the person reading it."""
    if seconds < 60:
        return f"{seconds}s"
    minutes = -(-seconds // 60)  # round up: never promise sooner than the truth
    return "a minute" if minutes == 1 else f"{minutes} minutes"


async def _check_throttles(
    session: AsyncSession,
    where_destination: ColumnElement[bool],
    request_ip: str | None,
) -> None:
    """Three counters, all read from the table so they hold across workers."""
    now = _now()

    last = await session.scalar(
        select(func.max(OtpCode.created_at)).where(where_destination)
    )
    if last is not None:
        elapsed = (now - last).total_seconds()
        if elapsed < settings.OTP_RESEND_SECONDS:
            wait = int(settings.OTP_RESEND_SECONDS - elapsed) + 1
            raise _too_many(f"Wait {wait}s before requesting another code", wait)

    window = timedelta(minutes=settings.OTP_WINDOW_MINUTES)
    window_start = now - window

    async def _oldest_and_count(*where) -> tuple[int, datetime | None]:
        row = (
            await session.execute(
                select(func.count(OtpCode.id), func.min(OtpCode.created_at)).where(
                    *where, OtpCode.created_at > window_start
                )
            )
        ).one()
        return int(row[0] or 0), row[1]

    def _refuse(oldest: datetime | None) -> None:
        # The wait is until the OLDEST request ages out of the window and frees
        # a slot — not the whole window. Someone who used their last code four
        # minutes ago waits one minute, not five. Quoting the window length
        # would be wrong in the direction that makes people force-quit the app.
        remaining = int((oldest + window - now).total_seconds()) + 1 if oldest else 1
        remaining = max(remaining, 1)
        raise _too_many(
            f"Too many codes requested. Try again in {_wait_phrase(remaining)}.",
            remaining,
        )

    per_destination, oldest_here = await _oldest_and_count(where_destination)
    if per_destination >= settings.OTP_MAX_PER_WINDOW:
        _refuse(oldest_here)

    if request_ip:
        per_ip, oldest_ip = await _oldest_and_count(OtpCode.request_ip == request_ip)
        if per_ip >= settings.OTP_MAX_PER_IP_PER_WINDOW:
            _refuse(oldest_ip)


async def _mint(
    session: AsyncSession,
    *,
    phone: str | None,
    email: str | None,
    purpose: str,
    user_id: uuid.UUID | None,
    invite_id: uuid.UUID | None,
    request_ip: str | None,
) -> tuple[OtpCode, str]:
    """Throttle, burn the live code, mint a new one. Does not send, does not commit.

    Split out so the two deliveries below share every rule that makes a code
    safe and differ only in how it travels. The row is added to the session but
    left uncommitted: the caller records what the provider said about the send
    on the same row, so one commit covers the code and its delivery.
    """
    destination = _destination(phone, email)
    where_destination = _destination_filter(phone, email)
    await _check_throttles(session, where_destination, request_ip)

    # Exactly one live code per destination. Without this, "the older message
    # also works" is a permanent source of confused support tickets.
    await session.execute(
        OtpCode.__table__.update()
        .where(where_destination, OtpCode.consumed_at.is_(None))
        .values(consumed_at=_now())
    )

    code = _generate_code()
    row = OtpCode(
        purpose=purpose,
        phone=phone,
        email=destination if email is not None else None,
        user_id=user_id,
        invite_id=invite_id,
        code_hash=_hash_code(destination, code),
        expires_at=_now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
    )
    row.request_ip = request_ip
    session.add(row)
    return row, code


def _echo(destination: str, code: str, channel: str, delivered: bool) -> None:
    """In development, make the code findable even when a real channel took it.

    The logging channel prints it only when WhatsApp is unconfigured — so the
    moment credentials exist (and every send is failing or allowlist-blocked)
    the code would vanish and nobody could sign in on a phone. The email path
    has the same problem the moment ACS is configured and the allowlist blocks
    the address. OTP_DEV_ECHO gates this, and startup refuses to boot with it
    enabled in production.
    """
    if settings.OTP_DEV_ECHO and channel != "log":
        logger.warning(
            "OTP for %s is %s (channel=%s, delivered=%s)",
            destination,
            code,
            channel,
            delivered,
        )


def _issued(sent: bool, channel: str, code: str) -> OtpRequestResponse:
    return OtpRequestResponse(
        sent=sent,
        channel=channel,
        expiresInSeconds=settings.OTP_TTL_SECONDS,
        resendInSeconds=settings.OTP_RESEND_SECONDS,
        devCode=code if settings.OTP_DEV_ECHO else None,
    )


async def issue_code(
    session: AsyncSession,
    *,
    phone: str,
    purpose: str,
    user_id: uuid.UUID | None = None,
    invite_id: uuid.UUID | None = None,
    request_ip: str | None = None,
) -> OtpRequestResponse:
    """Throttle, mint, deliver by WhatsApp, record. Commits."""
    row, code = await _mint(
        session,
        phone=phone,
        email=None,
        purpose=purpose,
        user_id=user_id,
        invite_id=invite_id,
        request_ip=request_ip,
    )

    channel = resolve_channel()
    result = await channel.send(phone, code)
    row.sent_channel = channel.name
    row.provider_message_id = result.message_id
    row.send_error = result.error
    await session.commit()

    _echo(phone, code, channel.name, result.ok)
    return _issued(result.ok, channel.name, code)


async def issue_email_code(
    session: AsyncSession,
    *,
    email: str,
    purpose: str,
    user_id: uuid.UUID,
    company_name: str,
    full_name: str | None,
    request_ip: str | None = None,
) -> OtpRequestResponse:
    """The same code, delivered by Azure Communication Services. Commits.

    Deliberately not a fourth `OtpChannel`: that Protocol is `send(phone, code)`
    and an email needs a subject, a greeting, the company it is sent on behalf
    of and an HTML body. Composing one is `app.emails`' job, not a channel's.
    """
    row, code = await _mint(
        session,
        phone=None,
        email=email,
        purpose=purpose,
        user_id=user_id,
        invite_id=None,
        request_ip=request_ip,
    )

    result = await account_email.send_password_reset_code(
        to=email,
        full_name=full_name,
        company_name=company_name,
        code=code,
        expires_minutes=max(1, settings.OTP_TTL_SECONDS // 60),
    )
    row.sent_channel = "email"
    row.provider_message_id = result.operation_id
    row.send_error = result.error
    await session.commit()

    _echo(email, code, "email", result.ok)
    return _issued(result.ok, "email", code)


async def consume_code(
    session: AsyncSession,
    *,
    code: str,
    purpose: str,
    phone: str | None = None,
    email: str | None = None,
) -> OtpCode:
    """Verify and burn a code. Raises 401 on anything that is not a clean match.

    Every failure returns the same message. Distinguishing "expired" from
    "wrong" tells an attacker which half of the guess was right.
    """
    destination = _destination(phone, email)
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="That code didn't match. Request a new one.",
    )

    row = await session.scalar(
        select(OtpCode)
        .where(
            _destination_filter(phone, email),
            OtpCode.purpose == purpose,
            OtpCode.consumed_at.is_(None),
        )
        .order_by(OtpCode.created_at.desc())
        .limit(1)
    )
    if row is None or row.expires_at <= _now():
        raise invalid

    if row.code_hash != _hash_code(destination, code):
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

    One line, because it IS the same thing — `issue_session` carries the shared
    tail so the password door and this one cannot drift. The access token it
    mints carries `company_id`; `require_company` 403s without it, so every
    gated technician endpoint would fail otherwise. `/auth/refresh` re-derives
    the company from `last_active_company_id` and needs no change here.
    """
    return await issue_session(session, user)


async def verify_login_code(
    session: AsyncSession, phone: str, code: str
) -> LoginResponse:
    user = await _find_technician_user(session, phone)
    await consume_code(session, phone=phone, code=code, purpose=PURPOSE_LOGIN)
    return await sign_in(session, user)


# ── console password reset ───────────────────────────────────────────────────
#
# The two code-bearing steps of the flow. Step three — setting the password —
# is `service.confirm_password_reset`, next to `change_password`, because by
# then there is no code left in the story.


async def request_password_reset(
    session: AsyncSession, email: str, request_ip: str | None
) -> OtpRequestResponse:
    """Email a one-time code to a console account that has forgotten its password."""
    user = await resettable_user(session, email)
    company_name = await reset_company_name(session, user)
    return await issue_email_code(
        session,
        # The address as it is stored, not as it was typed. `resettable_user`
        # matched case-insensitively, and the code is salted with its
        # destination — so minting against the typed casing would make a code
        # verify only when the second screen was typed the same way as the first.
        email=(user.email or email),
        purpose=PURPOSE_PASSWORD_RESET,
        user_id=user.id,
        company_name=company_name,
        full_name=user.full_name,
        request_ip=request_ip,
    )


async def verify_password_reset(
    session: AsyncSession, email: str, code: str
) -> PasswordResetVerifyResponse:
    """Burn the code and hand back the ticket that authorises the new password.

    The account is re-resolved rather than trusted from the code row: between
    the two requests it could have been disabled or deleted, and this is the
    last moment before a password is set at which that is cheap to notice.
    """
    user = await resettable_user(session, email)
    await consume_code(
        session,
        email=(user.email or email),
        code=code,
        purpose=PURPOSE_PASSWORD_RESET,
    )
    return PasswordResetVerifyResponse(
        resetToken=create_password_reset_token(
            user.id, user.password_hash or ""
        ),
        expiresInSeconds=settings.PASSWORD_RESET_TOKEN_MINUTES * 60,
    )
