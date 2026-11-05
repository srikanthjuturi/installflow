"""The guard on every CRM-facing call — who is calling, and are they still allowed?

`integration_guard("create_ticket")` is a dependency factory. It:

  1. reads the bearer token (`integration_tokens`) — a console token or a
     tampered one is refused, an expired one says so;
  2. re-reads the credential from the database in ONE query, and refuses unless it
     is not revoked, its vendor is active with the API channel still ticked, and
     its company is open. This is what makes revoking, pausing a vendor or
     switching the channel off take effect on the very next call: the token says
     WHO is calling, never that they are still permitted to;
  3. applies the per-minute limit;
  4. builds a vendor `Principal` from the vendor's primary login, so every
     `principal.vendor_id` / `principal.company_id` rule the portal already
     relies on works unchanged for a CRM.

It writes the call-log row itself for the refusals it raises, because the route
never runs for those.
"""

import datetime
import logging
import uuid
from dataclasses import dataclass
from typing import Annotated, Callable

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.integration_errors import refusal
from app.core.integration_log import (
    calls_in_window,
    is_over_limit,
    record_call,
    retry_after_seconds,
)
from app.core.integration_tokens import (
    TokenExpired,
    TokenInvalid,
    read_access_token,
)
from app.models.api_credential import ApiCredential
from app.models.company import Company
from app.models.membership import Membership
from app.models.role import ROLE_RANKS, VENDOR
from app.models.user import User
from app.models.vendor import Vendor

log = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


@dataclass
class IntegrationContext:
    """Who is calling: the vendor's authority, and the credential it came through."""

    principal: Principal
    credential_id: uuid.UUID
    company_id: uuid.UUID
    vendor_id: uuid.UUID
    vendor_name: str
    #: The call's own clock, for the duration written to the log.
    started: datetime.datetime


async def load_usable_credential(
    db: AsyncSession, credential_id: uuid.UUID, company_id: uuid.UUID | None = None
) -> tuple[ApiCredential, Vendor] | None:
    """The credential and its vendor IF the credential may be used right now.

    None means "no" for any reason — revoked, vendor gone or paused, API channel
    switched off, company closed. The caller words the refusal; this never says
    which, because the CRM is told the same thing for all of them.
    """
    stmt = (
        select(ApiCredential, Vendor)
        .join(
            Vendor,
            (Vendor.id == ApiCredential.vendor_id)
            & (Vendor.company_id == ApiCredential.company_id),
        )
        .join(Company, Company.id == ApiCredential.company_id)
        .where(
            ApiCredential.id == credential_id,
            ApiCredential.revoked_at.is_(None),
            Vendor.is_active.is_(True),
            Vendor.deleted_at.is_(None),
            Company.is_active.is_(True),
            Company.deleted_at.is_(None),
        )
    )
    if company_id is not None:
        stmt = stmt.where(ApiCredential.company_id == company_id)
    row = (await db.execute(stmt)).first()
    if row is None:
        return None
    credential, vendor = row
    if "API" not in (vendor.intake_channels or []):
        return None
    return credential, vendor


async def vendor_principal(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> Principal | None:
    """A vendor `Principal` built from the vendor's primary login, or None.

    The vendor's login is required when the vendor is created, so one normally
    exists; a vendor whose only login was deactivated cannot raise tickets, and
    that is the honest answer for its CRM too.
    """
    user = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.company_id == company_id,
            Membership.vendor_id == vendor_id,
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
            User.role == VENDOR,
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
        .order_by(Membership.created_at)
        .limit(1)
    )
    if user is None:
        return None
    return Principal(
        user=user,
        role=user.role,
        rank=ROLE_RANKS.get(user.role, max(ROLE_RANKS.values())),
        is_superadmin=False,
        company_id=company_id,
        vendor_id=vendor_id,
    )


def integration_guard(endpoint: str) -> Callable[..., object]:
    """The dependency for one CRM-facing endpoint. `endpoint` is the log's name for it."""

    async def guard(
        creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> IntegrationContext:
        started = datetime.datetime.now(datetime.timezone.utc)
        if creds is None:
            raise refusal("TOKEN_INVALID")
        try:
            who = read_access_token(creds.credentials)
        except TokenExpired as exc:
            if exc.who is not None:
                await record_call(
                    db,
                    company_id=exc.who.company_id,
                    vendor_id=exc.who.vendor_id,
                    credential_id=exc.who.credential_id,
                    endpoint=endpoint,
                    http_status=401,
                    outcome_code="TOKEN_EXPIRED",
                )
            raise refusal("TOKEN_EXPIRED") from None
        except TokenInvalid:
            raise refusal("TOKEN_INVALID") from None

        async def refuse(code: str, status: int, **kw) -> AppError:
            await record_call(
                db,
                company_id=who.company_id,
                vendor_id=who.vendor_id,
                credential_id=who.credential_id,
                endpoint=endpoint,
                http_status=status,
                outcome_code=code,
            )
            return refusal(code, **kw)

        loaded = await load_usable_credential(db, who.credential_id, who.company_id)
        if loaded is None:
            raise await refuse("INTEGRATION_DISABLED", 403)
        _credential, vendor = loaded

        count, oldest = await calls_in_window(db, who.credential_id, started)
        if is_over_limit(count):
            wait = retry_after_seconds(oldest, started)
            raise await refuse(
                "RATE_LIMITED", 429, headers={"Retry-After": str(wait)}
            )

        principal = await vendor_principal(db, who.company_id, vendor.id)
        if principal is None:
            raise await refuse("INTEGRATION_DISABLED", 403)

        return IntegrationContext(
            principal=principal,
            credential_id=who.credential_id,
            company_id=who.company_id,
            vendor_id=vendor.id,
            vendor_name=vendor.name,
            started=started,
        )

    return guard
