"""`app.core.integration_tokens` — the pure rules for a CRM's credential and tokens."""

import datetime
import uuid

import jwt
import pytest

from app.core.config import settings
from app.core.integration_tokens import (
    ACCESS_SECONDS,
    REFRESH_DAYS,
    SECRET_PREFIX,
    TokenExpired,
    TokenInvalid,
    hash_refresh_token,
    hash_secret,
    make_access_token,
    new_client_id,
    new_refresh_token,
    new_secret,
    read_access_token,
    refresh_expiry,
    slugify,
    verify_secret,
)
from app.core.security import create_access_token


def test_client_id_shape() -> None:
    cid = new_client_id("ABC Technologies Pvt. Ltd.")
    slug, digits = cid.rsplit("_", 1)
    assert slug == "abc_technologies_pvt_ltd"
    assert len(digits) == 3 and digits.isdigit()


def test_slug_is_never_empty_and_fits_the_column() -> None:
    assert slugify("!!!") == "vendor"
    assert len(new_client_id("x" * 300)) <= 64


def test_secret_is_prefixed_long_and_unique() -> None:
    a, b = new_secret(), new_secret()
    assert a.startswith(SECRET_PREFIX) and len(a) >= 40
    assert a != b


def test_secret_hash_and_verify() -> None:
    secret = new_secret()
    digest = hash_secret(secret)
    assert digest != secret and len(digest) == 64
    assert verify_secret(secret, digest)
    assert not verify_secret(secret + "x", digest)
    assert not verify_secret("", digest)


def test_refresh_token_is_long_unique_and_hashable() -> None:
    a, b = new_refresh_token(), new_refresh_token()
    assert a != b and len(a) >= 48
    assert hash_refresh_token(a) != a and len(hash_refresh_token(a)) == 64


def test_refresh_lives_thirty_days() -> None:
    now = datetime.datetime(2026, 11, 5, tzinfo=datetime.timezone.utc)
    assert refresh_expiry(now) - now == datetime.timedelta(days=REFRESH_DAYS) == datetime.timedelta(days=30)


def test_integration_token_reads_back() -> None:
    cred, company, vendor = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    read = read_access_token(make_access_token(cred, company, vendor))
    assert (read.credential_id, read.company_id, read.vendor_id) == (cred, company, vendor)
    assert ACCESS_SECONDS == 3600


def _forge(**overrides) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": str(uuid.uuid4()),
        "type": "integration",
        "company_id": str(uuid.uuid4()),
        "vendor_id": str(uuid.uuid4()),
        "iat": now,
        "exp": now + datetime.timedelta(minutes=5),
    }
    payload.update(overrides)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def test_expired_integration_token_is_reported_as_expired() -> None:
    past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)
    with pytest.raises(TokenExpired):
        read_access_token(_forge(exp=past))


def test_expired_console_token_is_invalid_not_expired() -> None:
    past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)
    with pytest.raises(TokenInvalid):
        read_access_token(_forge(type="access", exp=past))


def test_a_console_access_token_is_refused() -> None:
    with pytest.raises(TokenInvalid):
        read_access_token(create_access_token(uuid.uuid4(), uuid.uuid4()))


def test_tampered_and_garbage_tokens_are_refused() -> None:
    good = make_access_token(uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
    for bad in (good[:-3] + "abc", "not-a-token", ""):
        with pytest.raises(TokenInvalid):
            read_access_token(bad)


def test_missing_claims_are_refused() -> None:
    with pytest.raises(TokenInvalid):
        read_access_token(_forge(vendor_id="not-a-uuid"))
