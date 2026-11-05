"""Vendor CRM API — credentials and tokens (quickstart Scenario 1).

Driven against the dev database on the cast `seed_task05` builds: the console side
through the service with a hand-built principal, the CRM side through the real
HTTP routes (ASGI, no network). Run with:

    cd api
    DB_POOL_SIZE=4 DB_MAX_OVERFLOW=2 .venv/Scripts/python.exe -m pytest tests/integration/test_vendor_crm_credentials.py -v
"""

import asyncio
import datetime
import sys

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select, update

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.features.api_credentials import service  # noqa: E402
from app.features.api_credentials.schemas import ApiCredentialCreateRequest  # noqa: E402
from app.main import app  # noqa: E402
from app.models.api_credential import ApiRefreshToken  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from app.scripts import seed_task05  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402

TOKEN = "/api/v1/integration/token"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def _channels(db, w, channels: list[str]) -> None:
    await db.execute(
        update(Vendor).where(Vendor.id == w.vendor_id).values(intake_channels=channels)
    )
    await db.commit()


async def _revoke_all(db, admin, w) -> None:
    """Leave the vendor with no Active credential, so a run starts clean."""
    for c in await service.list_credentials(db, admin, w.vendor_id):
        if c.status == "Active":
            await service.revoke_credential(db, admin, c.id)


async def _token(http, cid: str, secret: str):
    return await http.post(TOKEN, json={"clientId": cid, "clientSecret": secret})


def test_credentials_and_tokens() -> None:
    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db, client() as http:
            admin = await t05.p(db, "admin")
            await _channels(db, w, ["API", "Manual", "Excel"])
            await _revoke_all(db, admin, w)

            # ── create: the secret is shown once and never listed ──────────
            first = await service.create_credential(
                db, admin, ApiCredentialCreateRequest(vendorId=w.vendor_id, note="Prod")
            )
            assert first.clientSecret.startswith("sk_live_")
            assert first.credential.status == "Active"
            assert first.emailStatus in ("sent", "failed", "skipped")
            listed = await service.list_credentials(db, admin, w.vendor_id)
            assert all(first.clientSecret not in c.model_dump_json() for c in listed)

            # ── several Active at once ─────────────────────────────────────
            second = await service.create_credential(
                db, admin, ApiCredentialCreateRequest(vendorId=w.vendor_id)
            )
            active = [
                c for c in await service.list_credentials(db, admin, w.vendor_id)
                if c.status == "Active"
            ]
            assert {c.id for c in active} == {first.credential.id, second.credential.id}

            # ── a token, and what it cannot do ─────────────────────────────
            ok = await _token(http, first.credential.clientId, first.clientSecret)
            assert ok.status_code == 200, ok.text
            tokens = ok.json()["data"]
            assert tokens["tokenType"] == "Bearer" and tokens["expiresIn"] == 3600
            assert tokens["refreshExpiresIn"] == 30 * 24 * 3600
            console = await http.get(
                "/api/v1/api-credentials",
                headers={"Authorization": f"Bearer {tokens['accessToken']}"},
            )
            assert console.status_code == 401  # a CRM token is not a console login

            # ── wrong secret and unknown client read the same ──────────────
            bad = await _token(http, first.credential.clientId, "sk_live_wrong")
            unknown = await _token(http, "nobody_000", "sk_live_wrong")
            for r in (bad, unknown):
                assert r.status_code == 401 and r.json()["code"] == "INVALID_CLIENT"
            assert bad.json()["message"] == unknown.json()["message"]

            # ── refresh: single use, rotates ───────────────────────────────
            renewed = await http.post(TOKEN, json={"refreshToken": tokens["refreshToken"]})
            assert renewed.status_code == 200
            assert renewed.json()["data"]["refreshToken"] != tokens["refreshToken"]
            again = await http.post(TOKEN, json={"refreshToken": tokens["refreshToken"]})
            assert again.status_code == 401 and again.json()["code"] == "TOKEN_INVALID"

            # ── the refresh token lives 30 days, and no longer ─────────────
            row = await db.scalar(
                select(ApiRefreshToken).where(
                    ApiRefreshToken.credential_id == first.credential.id,
                    ApiRefreshToken.used_at.is_(None),
                )
            )
            assert row is not None
            span = row.expires_at - row.created_at
            assert datetime.timedelta(days=29, hours=23) < span <= datetime.timedelta(days=30, minutes=1)
            await db.execute(
                update(ApiRefreshToken)
                .where(ApiRefreshToken.id == row.id)
                .values(expires_at=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1))
            )
            await db.commit()
            current = renewed.json()["data"]["refreshToken"]
            expired = await http.post(TOKEN, json={"refreshToken": current})
            # `current` is the row just expired: refused, and the secret still works.
            assert expired.status_code == 401 and expired.json()["code"] == "TOKEN_INVALID"
            assert (
                await _token(http, first.credential.clientId, first.clientSecret)
            ).status_code == 200

            # ── neither form, or both ──────────────────────────────────────
            assert (await http.post(TOKEN, json={})).status_code == 422
            assert (
                await http.post(
                    TOKEN,
                    json={"clientId": "a", "clientSecret": "b", "refreshToken": "c"},
                )
            ).status_code == 422

            # ── replace leaves the old one working ─────────────────────────
            replaced = await service.replace_credential(db, admin, second.credential.id)
            assert replaced.credential.replacesId == second.credential.id
            assert replaced.credential.clientId != second.credential.clientId
            still = await _token(http, second.credential.clientId, second.clientSecret)
            assert still.status_code == 200

            # ── revoke ends the credential and its refresh tokens ──────────
            live_refresh = (
                await _token(http, first.credential.clientId, first.clientSecret)
            ).json()["data"]["refreshToken"]
            revoked = await service.revoke_credential(db, admin, first.credential.id)
            assert revoked.status == "Revoked" and revoked.revokedAt is not None
            dead = await _token(http, first.credential.clientId, first.clientSecret)
            assert dead.status_code == 401 and dead.json()["code"] == "INVALID_CLIENT"
            gone = await http.post(TOKEN, json={"refreshToken": live_refresh})
            assert gone.status_code == 401
            # idempotent
            assert (await service.revoke_credential(db, admin, first.credential.id)).status == "Revoked"

            # ── channel off: nobody gets in ────────────────────────────────
            await _channels(db, w, ["Manual", "Excel"])
            off = await _token(http, second.credential.clientId, second.clientSecret)
            assert off.status_code == 403 and off.json()["code"] == "INTEGRATION_DISABLED"
            with pytest.raises(HTTPException) as err:
                await service.create_credential(
                    db, admin, ApiCredentialCreateRequest(vendorId=w.vendor_id)
                )
            assert err.value.code == "API_CHANNEL_OFF"
            await _channels(db, w, ["API", "Manual", "Excel"])

            await _revoke_all(db, admin, w)

    asyncio.run(go())


def test_another_company_cannot_see_or_revoke() -> None:
    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db:
            admin = await t05.p(db, "admin")
            await _channels(db, w, ["API", "Manual", "Excel"])
            made = await service.create_credential(
                db, admin, ApiCredentialCreateRequest(vendorId=w.vendor_id)
            )
            other = await seed_task05._principal_for(
                db,
                await seed_task05._user_by_email(db, w.company_b_admin_email),
                w.company_b_id,
            )
            assert await service.list_credentials(db, other) == []
            with pytest.raises(HTTPException) as no:
                await service.revoke_credential(db, other, made.credential.id)
            assert no.value.status_code == 404
            with pytest.raises(HTTPException) as no_vendor:
                await service.create_credential(
                    db, other, ApiCredentialCreateRequest(vendorId=w.vendor_id)
                )
            assert no_vendor.value.status_code == 404
            await service.revoke_credential(db, admin, made.credential.id)

    asyncio.run(go())
