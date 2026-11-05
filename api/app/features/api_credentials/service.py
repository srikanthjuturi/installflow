"""API credentials for a vendor's CRM — issuing them, and trading them for tokens.

Two jobs, one slice, no other slice imported (backend hard rule 4):

* the CONSOLE side — a company Admin or National Head lists, creates, replaces and
  revokes a vendor's credentials;
* the CRM side — `exchange` trades a Client ID and secret (or a refresh token)
  for an access token and a refresh token.

## The secret

Generated here, hashed straight away, and returned in the create response ONLY.
It is also emailed to the vendor's primary login. Nothing else ever holds it.

## Revoking

Sets `revoked_at` and ends every refresh token of the credential. Access tokens
need no separate hunt: the guard re-reads the credential on every call, so a
revoked credential's tokens fail on the very next one.
"""

import datetime
import logging
import uuid
from typing import NamedTuple

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import brand
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.integration_auth import load_usable_credential, vendor_principal
from app.core.integration_errors import refusal
from app.core.integration_log import (
    calls_in_window,
    is_over_limit,
    record_call,
    retry_after_seconds,
)
from app.core.integration_tokens import (
    ACCESS_SECONDS,
    REFRESH_SECONDS,
    hash_refresh_token,
    hash_secret,
    make_access_token,
    new_client_id,
    new_refresh_token,
    new_secret,
    refresh_expiry,
    verify_secret,
)
from app.emails.api_credential import send_api_credential
from app.features.api_credentials.schemas import (
    ApiCredentialCreatedOut,
    ApiLogOut,
    ApiCredentialCreateRequest,
    ApiCredentialOut,
    TokenOut,
    TokenRequest,
)
from app.models.api_credential import ApiCredential, ApiRefreshToken
from app.core.schemas import ListParams
from app.models.company import Company
from app.models.integration_log import ENDPOINTS, IntegrationCallLog
from app.models.vendor import Vendor

log = logging.getLogger(__name__)

#: Compared against when a Client ID is unknown, so "no such client" and "wrong
#: secret" cost the same time and cannot be told apart by a stopwatch.
_DUMMY_HASH = hash_secret("not-a-real-secret")

_ID_RETRIES = 6


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _not_found(what: str = "credential") -> HTTPException:
    # 404, never 403: another company's id must read exactly like one that does
    # not exist (hard rule 0).
    return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Unknown {what}")


def _out(row: ApiCredential, vendor_name: str) -> ApiCredentialOut:
    return ApiCredentialOut(
        id=row.id,
        vendorId=row.vendor_id,
        vendorName=vendor_name,
        clientId=row.client_id,
        note=row.note,
        status="Active" if row.revoked_at is None else "Revoked",
        createdAt=row.created_at,
        lastUsedAt=row.last_used_at,
        revokedAt=row.revoked_at,
        replacesId=row.replaces_id,
    )


# ── the console ──────────────────────────────────────────────────────────────


async def list_credentials(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID | None = None
) -> list[ApiCredentialOut]:
    stmt = (
        select(ApiCredential, Vendor.name)
        .join(
            Vendor,
            (Vendor.id == ApiCredential.vendor_id)
            & (Vendor.company_id == ApiCredential.company_id),
        )
        .where(ApiCredential.company_id == principal.company_id)
        .order_by(ApiCredential.created_at.desc())
    )
    if vendor_id is not None:
        stmt = stmt.where(ApiCredential.vendor_id == vendor_id)
    return [_out(row, name) for row, name in (await db.execute(stmt)).all()]


async def _load_vendor(
    db: AsyncSession, principal: Principal, vendor_id: uuid.UUID
) -> Vendor:
    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.company_id == principal.company_id,
            Vendor.deleted_at.is_(None),
        )
    )
    if vendor is None:
        raise _not_found("vendor")
    return vendor


async def _load(
    db: AsyncSession, principal: Principal, credential_id: uuid.UUID
) -> ApiCredential:
    row = await db.scalar(
        select(ApiCredential).where(
            ApiCredential.id == credential_id,
            ApiCredential.company_id == principal.company_id,
        )
    )
    if row is None:
        raise _not_found()
    return row


async def _issue(
    db: AsyncSession,
    principal: Principal,
    vendor: Vendor,
    *,
    note: str | None,
    replaces_id: uuid.UUID | None,
) -> ApiCredentialCreatedOut:
    if not vendor.is_active:
        raise AppError(
            http_status.HTTP_409_CONFLICT,
            "VENDOR_INACTIVE",
            "This vendor is paused. Reactivate it before issuing credentials.",
        )
    if "API" not in (vendor.intake_channels or []):
        raise AppError(
            http_status.HTTP_409_CONFLICT,
            "API_CHANNEL_OFF",
            "Switch the API intake channel on for this vendor first, then issue "
            "its credentials.",
        )

    secret = new_secret()
    row: ApiCredential | None = None
    for _ in range(_ID_RETRIES):
        candidate = ApiCredential(
            company_id=principal.company_id,
            vendor_id=vendor.id,
            client_id=new_client_id(vendor.name),
            secret_hash=hash_secret(secret),
            note=(note or "").strip() or None,
            replaces_id=replaces_id,
            created_by=principal.user_id,
        )
        try:
            # A savepoint, so a clash on the (global) unique Client ID retries
            # with fresh digits instead of poisoning the whole transaction.
            async with db.begin_nested():
                db.add(candidate)
                await db.flush()
            row = candidate
            break
        except IntegrityError:
            continue
    if row is None:
        raise AppError(
            http_status.HTTP_409_CONFLICT,
            "CLIENT_ID_UNAVAILABLE",
            "Could not find a free Client ID. Try again.",
        )
    await db.commit()
    await db.refresh(row)

    outcome = await _email_secret(db, principal, vendor, row, secret)
    return ApiCredentialCreatedOut(
        credential=_out(row, vendor.name), clientSecret=secret, **outcome
    )


async def _email_secret(
    db: AsyncSession,
    principal: Principal,
    vendor: Vendor,
    credential: ApiCredential,
    secret: str,
) -> dict[str, object]:
    """Send the credential to the vendor's primary login. Never raises."""
    login = await vendor_principal(db, vendor.company_id, vendor.id)
    if login is None or not login.user.email:
        return {
            "emailStatus": "skipped",
            "emailError": "The vendor has no active login with an email address.",
        }
    company_name = await db.scalar(select(Company.name).where(Company.id == vendor.company_id))
    result = await send_api_credential(
        to=str(login.user.email),
        full_name=login.user.full_name,
        company_name=brand.company_name(company_name),
        vendor_name=vendor.name,
        client_id=credential.client_id,
        client_secret=secret,
    )
    return {
        "emailStatus": "sent" if result.ok else "failed",
        "emailError": None if result.ok else result.error,
    }


async def create_credential(
    db: AsyncSession, principal: Principal, body: ApiCredentialCreateRequest
) -> ApiCredentialCreatedOut:
    vendor = await _load_vendor(db, principal, body.vendorId)
    return await _issue(db, principal, vendor, note=body.note, replaces_id=None)


async def replace_credential(
    db: AsyncSession, principal: Principal, credential_id: uuid.UUID
) -> ApiCredentialCreatedOut:
    """A NEW credential for the same vendor; the old one keeps working until revoked."""
    old = await _load(db, principal, credential_id)
    vendor = await _load_vendor(db, principal, old.vendor_id)
    return await _issue(db, principal, vendor, note=old.note, replaces_id=old.id)


async def revoke_credential(
    db: AsyncSession, principal: Principal, credential_id: uuid.UUID
) -> ApiCredentialOut:
    row = await _load(db, principal, credential_id)
    vendor_name = await db.scalar(select(Vendor.name).where(Vendor.id == row.vendor_id))
    if row.revoked_at is None:
        now = _now()
        row.revoked_at = now
        row.revoked_by = principal.user_id
        await db.execute(
            update(ApiRefreshToken)
            .where(
                ApiRefreshToken.credential_id == row.id,
                ApiRefreshToken.company_id == row.company_id,
                ApiRefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await db.commit()
        await db.refresh(row)
    return _out(row, vendor_name or "—")


# ── the CRM: trading credentials for tokens ──────────────────────────────────


async def _issue_tokens(db: AsyncSession, credential: ApiCredential) -> TokenOut:
    raw_refresh = new_refresh_token()
    db.add(
        ApiRefreshToken(
            company_id=credential.company_id,
            credential_id=credential.id,
            token_hash=hash_refresh_token(raw_refresh),
            expires_at=refresh_expiry(),
        )
    )
    access = make_access_token(credential.id, credential.company_id, credential.vendor_id)
    await db.commit()
    return TokenOut(
        accessToken=access,
        expiresIn=ACCESS_SECONDS,
        refreshToken=raw_refresh,
        refreshExpiresIn=REFRESH_SECONDS,
    )


async def exchange(db: AsyncSession, body: TokenRequest) -> TokenOut:
    """Trade a Client ID and secret, or a refresh token, for a new pair of tokens."""
    if body.refreshToken:
        return await _exchange_refresh(db, body.refreshToken)
    return await _exchange_secret(db, body.clientId or "", body.clientSecret or "")


class _Who(NamedTuple):
    """A credential's ids as PLAIN values. `record_call` rolls the session back,
    which expires every loaded object, so nothing may read the ORM row after it."""

    id: uuid.UUID
    company_id: uuid.UUID
    vendor_id: uuid.UUID


def _who(credential: ApiCredential) -> _Who:
    return _Who(credential.id, credential.company_id, credential.vendor_id)


async def _log(db: AsyncSession, who: _Who, http_status_code: int, code: str | None) -> None:
    await record_call(
        db,
        company_id=who.company_id,
        vendor_id=who.vendor_id,
        credential_id=who.id,
        endpoint="token",
        http_status=http_status_code,
        outcome_code=code,
    )


async def _refuse(db: AsyncSession, who: _Who, code: str, **kw) -> AppError:
    err = refusal(code, **kw)
    await _log(db, who, err.status_code, code)
    return err


async def _exchange_secret(db: AsyncSession, client_id: str, secret: str) -> TokenOut:
    credential = await db.scalar(
        select(ApiCredential).where(
            func.lower(ApiCredential.client_id) == client_id.strip().lower()
        )
    )
    if credential is None:
        # No company to own the row, so it goes to the server log only.
        verify_secret(secret, _DUMMY_HASH)
        log.warning("integration token request for an unknown client id")
        raise refusal("INVALID_CLIENT")

    who = _who(credential)
    revoked = credential.revoked_at is not None
    secret_hash = credential.secret_hash
    now = _now()
    count, oldest = await calls_in_window(db, who.id, now)
    if is_over_limit(count):
        raise await _refuse(
            db,
            who,
            "RATE_LIMITED",
            headers={"Retry-After": str(retry_after_seconds(oldest, now))},
        )

    if not verify_secret(secret, secret_hash) or revoked:
        # The same words for a wrong secret and a revoked credential.
        raise await _refuse(db, who, "INVALID_CLIENT")

    if await load_usable_credential(db, who.id, who.company_id) is None:
        raise await _refuse(db, who, "INTEGRATION_DISABLED")

    tokens = await _issue_tokens(db, credential)
    await _log(db, who, 200, None)
    return tokens


async def _exchange_refresh(db: AsyncSession, refresh_token: str) -> TokenOut:
    token_hash = hash_refresh_token(refresh_token)
    stored = await db.scalar(
        select(ApiRefreshToken).where(ApiRefreshToken.token_hash == token_hash)
    )
    if stored is None:
        raise refusal("TOKEN_INVALID")
    credential = await db.scalar(
        select(ApiCredential).where(
            ApiCredential.id == stored.credential_id,
            ApiCredential.company_id == stored.company_id,
        )
    )
    if credential is None:
        raise refusal("TOKEN_INVALID")

    who = _who(credential)
    used, revoked_token, expires = stored.used_at, stored.revoked_at, stored.expires_at
    stored_id = stored.id
    now = _now()
    if used is not None or revoked_token is not None or expires <= now:
        raise await _refuse(db, who, "TOKEN_INVALID")

    count, oldest = await calls_in_window(db, who.id, now)
    if is_over_limit(count):
        raise await _refuse(
            db,
            who,
            "RATE_LIMITED",
            headers={"Retry-After": str(retry_after_seconds(oldest, now))},
        )
    if await load_usable_credential(db, who.id, who.company_id) is None:
        raise await _refuse(db, who, "INTEGRATION_DISABLED")

    # Single use, decided by the database: two renewals at once with the same
    # token cannot both win.
    claimed = await db.execute(
        update(ApiRefreshToken)
        .where(ApiRefreshToken.id == stored_id, ApiRefreshToken.used_at.is_(None))
        .values(used_at=now)
    )
    if claimed.rowcount == 0:
        await db.rollback()
        raise await _refuse(db, who, "TOKEN_INVALID")

    tokens = await _issue_tokens(db, credential)
    await _log(db, who, 200, None)
    return tokens


# ── API Logs ─────────────────────────────────────────────────────────────────


async def list_logs(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    vendor_id: uuid.UUID | None = None,
    credential_id: uuid.UUID | None = None,
    endpoint: str | None = None,
    outcome: str | None = None,
    since: datetime.datetime | None = None,
    until: datetime.datetime | None = None,
) -> tuple[list[ApiLogOut], int]:
    """The company's own calls, newest first. Another company's are never reachable."""
    base = (
        select(IntegrationCallLog, ApiCredential.client_id, Vendor.name)
        .join(
            ApiCredential,
            (ApiCredential.id == IntegrationCallLog.credential_id)
            & (ApiCredential.company_id == IntegrationCallLog.company_id),
        )
        .join(
            Vendor,
            (Vendor.id == IntegrationCallLog.vendor_id)
            & (Vendor.company_id == IntegrationCallLog.company_id),
        )
        .where(IntegrationCallLog.company_id == principal.company_id)
    )
    if vendor_id is not None:
        base = base.where(IntegrationCallLog.vendor_id == vendor_id)
    if credential_id is not None:
        base = base.where(IntegrationCallLog.credential_id == credential_id)
    if endpoint is not None:
        if endpoint not in ENDPOINTS:
            return [], 0
        base = base.where(IntegrationCallLog.endpoint == endpoint)
    if outcome == "ok":
        base = base.where(IntegrationCallLog.http_status < 400)
    elif outcome == "error":
        base = base.where(IntegrationCallLog.http_status >= 400)
    if since is not None:
        base = base.where(IntegrationCallLog.created_at >= since)
    if until is not None:
        base = base.where(IntegrationCallLog.created_at <= until)

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.execute(
            base.order_by(IntegrationCallLog.created_at.desc(), IntegrationCallLog.id)
            .limit(params.limit)
            .offset(params.offset)
        )
    ).all()
    return (
        [
            ApiLogOut(
                id=log_row.id,
                occurredAt=log_row.created_at,
                vendorId=log_row.vendor_id,
                vendorName=vendor_name,
                credentialId=log_row.credential_id,
                clientId=client_id,
                endpoint=log_row.endpoint,
                httpStatus=log_row.http_status,
                outcomeCode=log_row.outcome_code,
                reference=log_row.crm_reference,
                checkOnly=log_row.check_only,
                repeat=log_row.repeat,
                ticketId=log_row.ticket_id,
                summary=log_row.detail,
                durationMs=log_row.duration_ms,
            )
            for log_row, client_id, vendor_name in rows
        ],
        int(total),
    )
