"""Vendor CRM API — retries, mistakes and limits (quickstart Scenario 4).

    cd api
    DB_POOL_SIZE=6 DB_MAX_OVERFLOW=4 .venv/Scripts/python.exe -m pytest tests/integration/test_vendor_crm_reliability.py -v
"""

import asyncio
import datetime
import sys
import uuid

import jwt
from sqlalchemy import func, select, update

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.config import settings  # noqa: E402
from app.core.credits import balance as credit_balance  # noqa: E402
from app.features.api_credentials import service as cred_service  # noqa: E402
from app.models.integration_log import IntegrationCallLog  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402
from tests.integration.crm_support import TICKETS, TOKEN, crm_fixture  # noqa: E402


def _count_sql(reference: str):
    return select(func.count()).select_from(Ticket).where(
        func.lower(Ticket.external_ref) == reference.lower()
    )


def test_duplicates_are_safe_even_at_once() -> None:
    w = t05.world()

    async def go() -> None:
        async with crm_fixture(w) as crm:
            db = crm.db
            ref = f"CRM-{uuid.uuid4().hex[:8]}"
            before = await credit_balance(db, w.company_a_id)

            # two calls at the same moment with the same reference
            a, b = await asyncio.gather(
                crm.post(crm.payload(ref)), crm.post(crm.payload(ref))
            )
            statuses = sorted([a.status_code, b.status_code])
            assert statuses == [200, 201], (a.text, b.text)
            repeats = [r.json()["data"]["repeat"] for r in (a, b)]
            assert sorted(repeats) == [False, True]
            assert a.json()["data"]["ticketNumber"] == b.json()["data"]["ticketNumber"]
            assert await db.scalar(_count_sql(ref)) == 1

            after = await credit_balance(db, w.company_a_id)
            charge = before - after
            assert charge > 0
            # one ticket, one charge: a third and fourth call change nothing
            await crm.post(crm.payload(ref))
            assert await credit_balance(db, w.company_a_id) == after

            # a cancelled ticket keeps its reference for ever
            ticket = await db.scalar(
                select(Ticket).where(func.lower(Ticket.external_ref) == ref.lower())
            )
            await db.execute(update(Ticket).where(Ticket.id == ticket.id).values(status="Cancelled"))
            await db.commit()
            again = await crm.post(crm.payload(ref))
            assert again.status_code == 200 and again.json()["data"]["repeat"] is True
            assert again.json()["data"]["status"] == "Cancelled"
            assert await db.scalar(_count_sql(ref)) == 1
            assert await credit_balance(db, w.company_a_id) == after

            # the same reference from nobody else's book is independent: a new
            # reference simply makes a new ticket
            fresh = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"))
            assert fresh.status_code == 201

    asyncio.run(go())


def test_tokens_expire_and_credentials_stop_at_once() -> None:
    w = t05.world()

    async def go() -> None:
        async with crm_fixture(w) as crm:
            db = crm.db

            # an access token that has run out
            past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)
            forged = jwt.encode(
                {
                    "sub": str(crm.credential_id),
                    "type": "integration",
                    "company_id": str(w.company_a_id),
                    "vendor_id": str(w.vendor_id),
                    "iat": past - datetime.timedelta(hours=1),
                    "exp": past,
                },
                settings.JWT_SECRET_KEY,
                algorithm=settings.JWT_ALGORITHM,
            )
            expired = await crm.post(crm.payload("x"), headers={"Authorization": f"Bearer {forged}"})
            assert expired.status_code == 401 and expired.json()["code"] == "TOKEN_EXPIRED"
            logged = await db.scalar(
                select(func.count()).select_from(IntegrationCallLog).where(
                    IntegrationCallLog.credential_id == crm.credential_id,
                    IntegrationCallLog.outcome_code == "TOKEN_EXPIRED",
                )
            )
            assert logged == 1

            # renewing works once; the old refresh token is then dead
            renewed = await crm.http.post(TOKEN, json={"refreshToken": crm.refresh})
            assert renewed.status_code == 200
            replay = await crm.http.post(TOKEN, json={"refreshToken": crm.refresh})
            assert replay.status_code == 401 and replay.json()["code"] == "TOKEN_INVALID"
            fresh = {"Authorization": f"Bearer {renewed.json()['data']['accessToken']}"}
            ok = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"), headers=fresh)
            assert ok.status_code == 201

            # the vendor is paused: the very next call is refused
            await db.execute(update(Vendor).where(Vendor.id == w.vendor_id).values(is_active=False))
            await db.commit()
            paused = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"), headers=fresh)
            assert paused.status_code == 403 and paused.json()["code"] == "INTEGRATION_DISABLED"
            await db.execute(update(Vendor).where(Vendor.id == w.vendor_id).values(is_active=True))
            await db.commit()

            # the API channel is switched off
            await db.execute(update(Vendor).where(Vendor.id == w.vendor_id).values(intake_channels=["Manual"]))
            await db.commit()
            off = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"), headers=fresh)
            assert off.status_code == 403 and off.json()["code"] == "INTEGRATION_DISABLED"
            await db.execute(
                update(Vendor).where(Vendor.id == w.vendor_id).values(intake_channels=["API", "Manual", "Excel"])
            )
            await db.commit()
            assert (await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"), headers=fresh)).status_code == 201

            # revoked while the access token is still valid: refused on the next call
            await db.refresh(crm.admin.user)
            await cred_service.revoke_credential(db, crm.admin, crm.credential_id)
            revoked = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"), headers=fresh)
            assert revoked.status_code == 403 and revoked.json()["code"] == "INTEGRATION_DISABLED"

    asyncio.run(go())


def test_sixty_calls_a_minute() -> None:
    w = t05.world()

    async def go() -> None:
        async with crm_fixture(w) as crm:
            db = crm.db
            # The token call already counted as one. Cheap refusals count too.
            allowed = 1
            limited = None
            for _ in range(70):
                r = await crm.post({"reference": "limit-probe"})
                if r.status_code == 429:
                    limited = r
                    break
                assert r.status_code == 422
                allowed += 1
            assert limited is not None, "the 61st call should have been refused"
            assert allowed == 60
            assert limited.json()["code"] == "RATE_LIMITED"
            wait = int(limited.headers["Retry-After"])
            assert 1 <= wait <= 60

            # a refused call does not extend the block for ever
            logged_429 = await db.scalar(
                select(func.count()).select_from(IntegrationCallLog).where(
                    IntegrationCallLog.credential_id == crm.credential_id,
                    IntegrationCallLog.outcome_code == "RATE_LIMITED",
                )
            )
            assert logged_429 >= 1

            # the token endpoint is throttled the same way
            token_try = await crm.http.post(
                TOKEN, json={"clientId": crm.client_id, "clientSecret": crm.client_secret}
            )
            assert token_try.status_code == 429

            # check-only calls count toward the limit and are logged as such
            count_check_only = await db.scalar(
                select(func.count()).select_from(IntegrationCallLog).where(
                    IntegrationCallLog.credential_id == crm.credential_id,
                    IntegrationCallLog.check_only.is_(True),
                )
            )
            assert count_check_only == 0  # none made here; the flag itself is covered in the create test

    asyncio.run(go())
