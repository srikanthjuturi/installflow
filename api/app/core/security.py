"""JWT token helpers and password hashing.

Utilities only — no routes are wired up in this phase. Auth features will import
these when the API phase begins.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings


# ─── Password hashing (bcrypt) ─────────────────────────────────────────────
def hash_password(plain_password: str) -> str:
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


# ─── JWT ───────────────────────────────────────────────────────────────────
def _create_token(
    subject: str | Any,
    expires_delta: timedelta,
    token_type: str,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(
    subject: str | Any, company_id: str | None = None
) -> str:
    """Access token. `company_id` is the active tenant (None for superadmin)."""
    extra = {"company_id": str(company_id)} if company_id else None
    return _create_token(
        subject,
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        token_type="access",
        extra_claims=extra,
    )


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT. Raises jwt.PyJWTError on failure."""
    return jwt.decode(
        token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )


# ─── Opaque refresh-token material (stored hashed for revocation) ──────────
def generate_refresh_token() -> str:
    """A high-entropy opaque token handed to the client verbatim."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """SHA-256 hex digest — what we persist so a DB leak can't replay tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
