"""Verifying a Google ID token.

⚠ This module RAISES, unlike every other file in `integrations/`.

The rule in `api/AGENTS.md` is that an integration is *outbound* and never
raises, and `whatsapp.py` gives the reason: a delivery failure must leave a
retryable record rather than lose it. This is INBOUND verification. There is no
record to preserve, and a bad token has exactly one correct outcome — a rejected
sign-in — so returning something falsy would make every caller responsible for
remembering to check, which is the class of bug that rule exists to prevent.
`blob.ensure_*_container` already raises in this folder for a similar reason.

What it raises is `GoogleIdentityError`, never `HTTPException`: this file stays
free of FastAPI, and the auth SERVICE decides the status code and the wording —
exactly as `otp_service` decides what an `OtpChannel` failure means.

Verification is done here rather than with `google-auth` because that library's
`verify_oauth2_token` is synchronous and would block the event loop on every
sign-in; `jwt.PyJWKClient` is rejected for the same reason plus one more — it
fetches with `urllib` and offers no hook for `HTTP_CA_BUNDLE`, which this repo
relies on for dev machines behind a TLS-intercepting proxy.

The credential is never logged. It is a bearer token for its lifetime.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx
import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"

#: Google mints tokens under both spellings and treats them as equivalent.
_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})

#: Google's signing keys are good for hours and rotations are published well in
#: advance, so an hour is comfortably safe.
_TTL_SECONDS = 3600.0

#: Floor between forced refetches on an unknown `kid`. Without it, anybody
#: posting garbage headers turns this endpoint into a request amplifier aimed at
#: Google.
_MIN_REFETCH_SECONDS = 60.0

_keys: dict[str, jwt.PyJWK] = {}
_fetched_at: float = 0.0
#: An asyncio lock, not a threading one: every caller is on the single event
#: loop of its uvicorn worker. Gunicorn runs N processes, so there are N caches —
#: fine, these are public keys.
_lock = asyncio.Lock()


class GoogleIdentityError(Exception):
    """A Google sign-in that cannot be honoured.

    `code` is one of: MALFORMED · UNKNOWN_KEY · BAD_SIGNATURE · AUDIENCE ·
    ISSUER · EXPIRED · NO_EMAIL · UNVERIFIED_EMAIL · JWKS_UNAVAILABLE
    """

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class GoogleIdentity:
    """Who Google says this is. `email` is already stripped and lowercased."""

    email: str
    sub: str
    name: str | None = None
    picture: str | None = None
    #: The Workspace domain, when there is one. Not used for access decisions —
    #: membership is what grants access — but useful in a log.
    hd: str | None = None


def is_configured() -> bool:
    """False also when the id is set but is obviously not a Google client id.

    A typo there produces a uniform AUDIENCE rejection for every user, which
    reads as "Google is broken". Answering "not configured" instead gives the
    503 that names the real problem.
    """
    client_id = settings.GOOGLE_CLIENT_ID.strip()
    if not client_id:
        return False
    if not client_id.endswith(".apps.googleusercontent.com"):
        logger.warning(
            "GOOGLE_CLIENT_ID does not look like a Google OAuth client id; "
            "treating Google sign-in as unconfigured"
        )
        return False
    return True


async def _fetch_keys() -> None:
    """Replace the cache from Google. Caller holds the lock."""
    global _fetched_at
    async with httpx.AsyncClient(
        timeout=10, verify=settings.HTTP_CA_BUNDLE or True
    ) as client:
        response = await client.get(_CERTS_URL)
        response.raise_for_status()
        key_set = jwt.PyJWKSet.from_dict(response.json())
    _keys.clear()
    for key in key_set.keys:
        if key.key_id:
            _keys[key.key_id] = key
    _fetched_at = time.monotonic()


async def _key_for(kid: str) -> jwt.PyJWK:
    """The signing key for `kid`, refetching if it is unknown or stale.

    A fetch failure with keys still in hand is survivable, and survived
    deliberately: Google rotates roughly fortnightly and publishes successors
    well in advance, so failing every sign-in because googleapis.com blipped for
    ten seconds is the worse outcome. Only an empty cache is fatal.
    """
    async with _lock:
        age = time.monotonic() - _fetched_at
        stale = age > _TTL_SECONDS
        missing = kid not in _keys
        # Rate-limit the miss-triggered refetch; the TTL one is self-limiting.
        may_refetch = stale or (missing and age > _MIN_REFETCH_SECONDS)

        if may_refetch:
            try:
                await _fetch_keys()
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                if not _keys:
                    logger.warning("Could not fetch Google's signing keys: %s", exc)
                    raise GoogleIdentityError(
                        "JWKS_UNAVAILABLE", "Could not reach Google to verify the sign-in"
                    ) from exc
                logger.warning(
                    "Could not refresh Google's signing keys (%s); using cached ones",
                    exc,
                )

        key = _keys.get(kid)
        if key is None:
            raise GoogleIdentityError(
                "UNKNOWN_KEY", "Google signed this with a key we do not recognise"
            )
        return key


async def verify_id_token(credential: str) -> GoogleIdentity:
    """Verify a Google ID token and return who it says signed in.

    Raises `GoogleIdentityError` on anything that is not a clean, current,
    audience-matched token for a verified email address.
    """
    if not is_configured():
        raise GoogleIdentityError(
            "NOT_CONFIGURED", "Google sign-in is not configured on this server"
        )

    try:
        header = jwt.get_unverified_header(credential)
    except jwt.PyJWTError as exc:
        raise GoogleIdentityError("MALFORMED", "That is not a Google sign-in token") from exc

    kid = header.get("kid")
    # `algorithms=["RS256"]` below already blocks `alg: none` and the RS→HS
    # confusion attack; rejecting here only buys a clearer error.
    if header.get("alg") != "RS256" or not kid:
        raise GoogleIdentityError("MALFORMED", "That is not a Google sign-in token")

    key = await _key_for(kid)

    try:
        payload = jwt.decode(
            credential,
            key=key,
            algorithms=["RS256"],
            audience=settings.GOOGLE_CLIENT_ID.strip(),
            issuer=_ISSUERS,
            # The token lives an hour, so 30s of clock skew costs nothing.
            leeway=30,
            options={"require": ["exp", "iat", "aud", "iss", "sub", "email"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise GoogleIdentityError("EXPIRED", "That Google sign-in has expired") from exc
    except jwt.InvalidAudienceError as exc:
        # The ONLY failure whose fix is a config change and whose symptom is
        # otherwise mute — so log both sides of the comparison.
        try:
            got = jwt.decode(credential, options={"verify_signature": False}).get("aud")
        except jwt.PyJWTError:
            got = "<unreadable>"
        logger.warning(
            "Google token audience mismatch: token aud=%s, GOOGLE_CLIENT_ID=%s",
            got,
            settings.GOOGLE_CLIENT_ID,
        )
        raise GoogleIdentityError(
            "AUDIENCE", "That Google sign-in was issued for a different application"
        ) from exc
    except jwt.InvalidIssuerError as exc:
        raise GoogleIdentityError("ISSUER", "That token was not issued by Google") from exc
    except jwt.InvalidSignatureError as exc:
        raise GoogleIdentityError("BAD_SIGNATURE", "That token's signature is wrong") from exc
    except jwt.PyJWTError as exc:
        raise GoogleIdentityError("MALFORMED", "That is not a Google sign-in token") from exc

    email = (payload.get("email") or "").strip()
    if not email:
        raise GoogleIdentityError("NO_EMAIL", "That Google account has no email address")
    # `is True`, not truthiness: Google sends a real boolean, and accepting the
    # string "false" — which is truthy — would accept an unverified address.
    if payload.get("email_verified") is not True:
        raise GoogleIdentityError(
            "UNVERIFIED_EMAIL", "That Google account's email address is not verified"
        )

    return GoogleIdentity(
        email=email.lower(),
        sub=str(payload["sub"]),
        name=payload.get("name"),
        picture=payload.get("picture"),
        hd=payload.get("hd"),
    )
