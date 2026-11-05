"""Credentials and tokens for a vendor's CRM — the rules, with no database.

A CRM holds a Client ID and a Client Secret. It trades them for a one-hour
access token and a 30-day refresh token, then uses the access token on every
call. Nothing here touches a session: the database halves live in
`integration_auth` and the credentials slice.

## Why the secret is hashed with SHA-256 and not a password hash

The secret is 256 random bits, not something a person chose, so there is nothing
for a slow hash to defend against and a fast one is the honest choice — the same
reasoning `security.hash_token` already makes for refresh tokens.

## Why the access token is a JWT with its own `type`

`deps.get_current_principal` refuses anything whose `type` is not `access`, so a
CRM's token can never be presented as a console login. The token only says WHO
is calling; whether they are still allowed to is re-read from the database on
every call, which is what makes revoking take effect at once.
"""

import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

import jwt

from app.core.config import settings
from app.core.security import hash_token

INTEGRATION_TOKEN_TYPE = "integration"
ACCESS_SECONDS = 3600
REFRESH_DAYS = 30
REFRESH_SECONDS = REFRESH_DAYS * 24 * 3600

#: What a secret starts with, so a leaked one is recognisable on sight.
SECRET_PREFIX = "sk_live_"

#: `client_id` is varchar(64): the slug, an underscore and three digits.
MAX_CLIENT_ID = 64
_SLUG_MAX = MAX_CLIENT_ID - 4


def slugify(name: str) -> str:
    """Lower-case ASCII words joined by underscores. Never empty."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return (slug or "vendor")[:_SLUG_MAX].rstrip("_") or "vendor"


def new_client_id(vendor_name: str) -> str:
    """`<vendor-slug>_<3 digits>`, e.g. `abc_technologies_001`.

    The digits are random rather than a counter, so two credentials made at the
    same instant do not need to agree on one. The caller retries on the (rare)
    unique clash.
    """
    return f"{slugify(vendor_name)}_{secrets.randbelow(1000):03d}"


def new_secret() -> str:
    """A prefixed 256-bit random secret, shown to the admin once."""
    return SECRET_PREFIX + secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return hash_token(secret)


def verify_secret(secret: str, secret_hash: str) -> bool:
    """Constant-time. An empty secret never verifies."""
    if not secret:
        return False
    return secrets.compare_digest(hash_secret(secret), secret_hash)


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hash_token(token)


def refresh_expiry(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)) + timedelta(days=REFRESH_DAYS)


def make_access_token(
    credential_id: uuid.UUID, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(credential_id),
        "type": INTEGRATION_TOKEN_TYPE,
        "company_id": str(company_id),
        "vendor_id": str(vendor_id),
        "iat": now,
        "exp": now + timedelta(seconds=ACCESS_SECONDS),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


class TokenRead(NamedTuple):
    credential_id: uuid.UUID
    company_id: uuid.UUID
    vendor_id: uuid.UUID


class TokenExpired(Exception):
    """The token was genuine and has run out: the CRM should renew it.

    Carries who it was for, so the call can still be logged against them.
    """

    def __init__(self, who: "TokenRead | None" = None) -> None:
        super().__init__("token expired")
        self.who = who


class TokenInvalid(Exception):
    """Anything else wrong with a token."""


def read_access_token(token: str) -> TokenRead:
    """Verify a CRM access token. Raises `TokenExpired` or `TokenInvalid`.

    A console access token, a refresh or reset token and a tampered token are all
    `TokenInvalid`; only a genuine integration token past its time is
    `TokenExpired`.
    """
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
    except jwt.ExpiredSignatureError:
        # Signature checked first by PyJWT, so this is a genuine token — but it
        # still has to be an integration token, or a stale console token would
        # be told to "renew" something it can never renew.
        try:
            unverified = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_exp": False},
            )
        except jwt.PyJWTError:
            raise TokenInvalid() from None
        if unverified.get("type") != INTEGRATION_TOKEN_TYPE:
            raise TokenInvalid() from None
        try:
            who = TokenRead(
                credential_id=uuid.UUID(str(unverified["sub"])),
                company_id=uuid.UUID(str(unverified["company_id"])),
                vendor_id=uuid.UUID(str(unverified["vendor_id"])),
            )
        except (KeyError, ValueError, TypeError):
            raise TokenInvalid() from None
        raise TokenExpired(who) from None
    except jwt.PyJWTError:
        raise TokenInvalid() from None

    if payload.get("type") != INTEGRATION_TOKEN_TYPE:
        raise TokenInvalid()
    try:
        return TokenRead(
            credential_id=uuid.UUID(str(payload["sub"])),
            company_id=uuid.UUID(str(payload["company_id"])),
            vendor_id=uuid.UUID(str(payload["vendor_id"])),
        )
    except (KeyError, ValueError, TypeError):
        raise TokenInvalid() from None
