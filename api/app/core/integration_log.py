"""The call log for the vendor CRM API — writing a row, and counting for the limit.

## Why it rolls the request's session back before it writes

A refused call has usually rolled the request's transaction back (a ticket that
fails a credit check leaves nothing), and the log is exactly the record of that
refusal. The row is written on the SAME session, after a rollback, because the
pool has one connection: a second session would deadlock against the request
that is holding it (see `record_call`). A failure to log is logged and
swallowed: a CRM must never get an error because our bookkeeping hiccuped.

## What is never written

A Client Secret, an access token, a refresh token or the Authorization header.
`summarize_ticket_request` keeps only what explains the call, and masks the
customer's phone; names and addresses are left out altogether.

A call whose Client ID matches no credential has no company to own it, so it is
logged to the server log and never reaches this table.
"""

import datetime
import logging
import math
import uuid
from typing import Any

from sqlalchemy import and_, delete, func, or_, select, update

from app.models.api_credential import ApiCredential, ApiRefreshToken
from app.models.integration_log import IntegrationCallLog

log = logging.getLogger(__name__)

#: Calls a credential may make in any rolling minute, all endpoints together.
CALLS_PER_MINUTE = 60
WINDOW_SECONDS = 60


def retry_after_seconds(
    oldest_in_window: datetime.datetime | None, now: datetime.datetime
) -> int:
    """Whole seconds until the oldest counted call leaves the window. At least 1."""
    if oldest_in_window is None:
        return 1
    left = WINDOW_SECONDS - (now - oldest_in_window).total_seconds()
    return max(1, math.ceil(left))


def is_over_limit(calls_in_window: int) -> bool:
    return calls_in_window >= CALLS_PER_MINUTE


def mask_phone(phone: str | None) -> str | None:
    """`+91XXXXXX3210` — enough to match a call to a customer, not to ring them."""
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    return "+91" + "X" * 6 + digits[-4:] if len(digits) >= 4 else "X" * len(digits)


def summarize_ticket_request(body: dict[str, Any]) -> dict[str, Any]:
    """What explains a create call, without the customer's personal details."""
    keep = (
        "reference",
        "sku",
        "serialNumber",
        "serviceType",
        "expectedDate",
        "pincode",
        "city",
        "visitStart",
        "visitEnd",
        "checkOnly",
    )
    summary = {k: body.get(k) for k in keep if body.get(k) is not None}
    if body.get("customerPhone"):
        summary["customerPhone"] = mask_phone(str(body["customerPhone"]))
    return summary


async def calls_in_window(
    db, credential_id: uuid.UUID, now: datetime.datetime | None = None
) -> tuple[int, datetime.datetime | None]:
    """How many calls this credential made in the last minute, and the oldest.

    A call refused for the rate limit does not count: otherwise a client that
    keeps hammering would keep itself blocked for ever.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    since = now - datetime.timedelta(seconds=WINDOW_SECONDS)
    row = (
        await db.execute(
            select(func.count(), func.min(IntegrationCallLog.created_at)).where(
                IntegrationCallLog.credential_id == credential_id,
                IntegrationCallLog.created_at > since,
                IntegrationCallLog.outcome_code.is_distinct_from("RATE_LIMITED"),
            )
        )
    ).one()
    return int(row[0]), row[1]


async def record_call(
    db,
    *,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    credential_id: uuid.UUID,
    endpoint: str,
    http_status: int,
    outcome_code: str | None = None,
    check_only: bool = False,
    crm_reference: str | None = None,
    ticket_id: uuid.UUID | None = None,
    repeat: bool = False,
    detail: dict[str, Any] | None = None,
    duration_ms: int | None = None,
) -> None:
    """Write one log row on the REQUEST's session. Never raises.

    It rolls the session back first, and that is the point of taking it:

    * ⚠ **The pool has ONE connection** (`DB_POOL_SIZE=1`, no overflow, in every
      environment). A request holds it for as long as its session has a
      transaction open, so a log written on a SECOND session would wait for a
      connection the request itself is holding — a self-deadlock that ends 30
      seconds later in a pool timeout. Rolling back releases the connection (and
      clears a failed transaction), and the log row then reuses it.
    * By the time a call is logged its work is committed or has failed, so there
      is nothing in the session worth keeping.

    Everything the caller still needs afterwards must be a plain value captured
    BEFORE this call: the rollback expires every loaded object.
    """
    try:
        await db.rollback()
        db.add(
            IntegrationCallLog(
                company_id=company_id,
                vendor_id=vendor_id,
                credential_id=credential_id,
                endpoint=endpoint,
                http_status=http_status,
                outcome_code=outcome_code,
                check_only=check_only,
                crm_reference=crm_reference,
                ticket_id=ticket_id,
                repeat=repeat,
                detail=detail,
                duration_ms=duration_ms,
            )
        )
        if http_status < 400:
            await db.execute(
                update(ApiCredential)
                .where(
                    ApiCredential.id == credential_id,
                    ApiCredential.company_id == company_id,
                )
                .values(last_used_at=func.now())
            )
        await db.commit()
    except Exception:  # noqa: BLE001 — logging must never fail a call
        log.exception("could not write an integration call log row")
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass


#: How long a call's DETAIL (the redacted request summary) is kept, and how long
#: the summary ROW (time, vendor, credential, endpoint, result) is kept.
DETAIL_DAYS = 30
ROW_DAYS = 365
#: A used, revoked or expired refresh token is deleted this long after it stopped
#: being useful.
TOKEN_GRACE_DAYS = 30


async def sweep_api_log_retention(db) -> int:
    """Clear call details after 30 days, delete call rows after a year, and tidy
    spent refresh tokens. Idempotent: a second run changes nothing.

    Returns 0 always: the scheduler reads the return value as "notifications
    raised", and this raises none. It logs what it did instead.
    """
    now = datetime.datetime.now(datetime.timezone.utc)

    cleared = await db.execute(
        update(IntegrationCallLog)
        .where(
            IntegrationCallLog.created_at < now - datetime.timedelta(days=DETAIL_DAYS),
            IntegrationCallLog.detail.is_not(None),
        )
        .values(detail=None)
    )
    deleted = await db.execute(
        delete(IntegrationCallLog).where(
            IntegrationCallLog.created_at < now - datetime.timedelta(days=ROW_DAYS)
        )
    )
    grace = now - datetime.timedelta(days=TOKEN_GRACE_DAYS)
    tokens = await db.execute(
        delete(ApiRefreshToken).where(
            or_(
                ApiRefreshToken.expires_at < grace,
                and_(ApiRefreshToken.used_at.is_not(None), ApiRefreshToken.used_at < grace),
                and_(ApiRefreshToken.revoked_at.is_not(None), ApiRefreshToken.revoked_at < grace),
            )
        )
    )
    if cleared.rowcount or deleted.rowcount or tokens.rowcount:
        log.info(
            "api log retention: cleared %d detail(s), deleted %d row(s), %d token(s)",
            cleared.rowcount,
            deleted.rowcount,
            tokens.rowcount,
        )
    return 0
