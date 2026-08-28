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
#: bcrypt's hard limit, and it is BYTES, not characters. Older versions
#: truncated silently; bcrypt 5 raises instead, which is better — but it means
#: an over-long password is an exception on a hot path rather than a quiet
#: weakening, and both callers below have to say what they do about it.
#:
#: Worth remembering that 72 bytes is far fewer than 72 characters for anyone
#: not typing ASCII: an emoji is four, and Devanagari is three.
BCRYPT_MAX_BYTES = 72


def too_long_for_bcrypt(plain_password: str) -> bool:
    return len(plain_password.encode("utf-8")) > BCRYPT_MAX_BYTES


def hash_password(plain_password: str) -> str:
    """Hash a password. Raises ValueError past bcrypt's 72-BYTE limit.

    Callers that take the password from a request must bound it in their schema
    (see `BoundedPassword`), so the caller gets a 422 naming the field rather
    than a 500 from in here.
    """
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check a password. NEVER raises — an unusable candidate is simply False.

    The length guard is not cosmetic. `/auth/login` accepts whatever the client
    sends, and bcrypt 5 raises on anything over 72 bytes, so without this an
    over-long password turns an ordinary failed sign-in into a 500 — from an
    UNAUTHENTICATED endpoint, on attacker-chosen input.

    False is also the correct answer, not merely the safe one: nothing could
    ever have hashed a string bcrypt refuses to hash, so no stored hash can
    match it.
    """
    if too_long_for_bcrypt(plain_password):
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"), hashed_password.encode("utf-8")
        )
    except ValueError:
        # A malformed or truncated stored hash. A database in that state is a
        # problem, but it is not this caller's problem and it is not a 500 —
        # they simply cannot sign in.
        return False


#: Every confusable pair removed: no I/O against 1/0, no lowercase l. This
#: string is read off a screen in an email and typed into a login form on a
#: different device, and a misread costs a support call — staff have no password
#: reset, so the only remedy is a manager reissuing it.
#:
#: No symbols. They would add ~2.5 bits and cost far more than that in
#: phone-keyboard friction and in "is that a comma or a full stop".
_TEMP_ALPHABET = (
    "ABCDEFGHJKLMNPQRSTUVWXYZ"  # no I, no O
    "abcdefghijkmnopqrstuvwxyz"  # no l
    "23456789"  # no 0, no 1
)


def generate_temporary_password() -> str:
    """A random first password, e.g. `hK4m-Q2xv-R9tB`.

    12 random characters from 57 symbols is ~70 bits — orders of magnitude past
    anything bcrypt plus login throttling needs. The hyphens are fixed, so they
    cost no entropy; they make the string readable at a glance and make it
    visibly machine-generated, so nobody mistakes it for one they chose.

    `secrets.choice`, deliberately not `secrets.token_urlsafe`, whose alphabet
    contains `-`, `_` and every ambiguous character removed above.

    No character-class rejection sampling: there is no complexity policy
    anywhere in this codebase. If one is ever added it belongs immediately next
    to this function, or the generator starts producing passwords the API
    rejects.

    The rule that binds every caller: **this value is never logged.** Same rule
    `integrations/whatsapp.py` states for the invite token and the OTP.
    """
    groups = [
        "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(4)) for _ in range(3)
    ]
    return "-".join(groups)


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
