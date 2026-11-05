"""Vendor CRM API — API Logs, the Source filter and retention (quickstart Scenario 6).

    cd api
    DB_POOL_SIZE=6 DB_MAX_OVERFLOW=4 .venv/Scripts/python.exe -m pytest tests/integration/test_vendor_crm_logs.py -v
"""

import asyncio
import datetime
import sys
import uuid

from sqlalchemy import select, update

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.integration_log import sweep_api_log_retention  # noqa: E402
from app.core.schemas import ListParams  # noqa: E402
from app.features.api_credentials import service as cred_service  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.models.api_credential import ApiRefreshToken  # noqa: E402
from app.models.integration_log import IntegrationCallLog  # noqa: E402
from app.scripts import seed_task05  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402
from tests.integration.crm_support import TICKETS, crm_fixture  # noqa: E402


def test_logs_source_filter_and_retention() -> None:
    w = t05.world()

    async def go() -> None:
        async with crm_fixture(w) as crm:
            db, admin = crm.db, crm.admin

            ref = f"CRM-{uuid.uuid4().hex[:8]}"
            ok = await crm.post(crm.payload(ref))
            assert ok.status_code == 201
            number = ok.json()["data"]["ticketNumber"]
            await crm.post(crm.payload(ref))  # a repeat
            await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}", sku="NO-SUCH-SKU"))
            await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}", checkOnly=True))
            await crm.http.get(f"{TICKETS}/{ref}", headers=crm.auth)
            await crm.http.get(f"{TICKETS}/NOPE", headers=crm.auth)
            await crm.http.get(
                TICKETS,
                params={"changedSince": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)).isoformat()},
                headers=crm.auth,
            )

            # ── every kind of call is there, with its result ──────────────
            logs, total = await cred_service.list_logs(
                db, admin, ListParams(limit=100), credential_id=crm.credential_id
            )
            assert total == len(logs) >= 8
            seen = {(l.endpoint, l.httpStatus, l.outcomeCode, l.checkOnly, l.repeat) for l in logs}
            assert ("token", 200, None, False, False) in seen
            assert ("create_ticket", 201, None, False, False) in seen
            assert ("create_ticket", 200, None, False, True) in seen  # the repeat
            assert ("create_ticket", 400, "UNKNOWN_SKU", False, False) in seen
            assert ("create_ticket", 200, None, True, False) in seen  # check only
            assert ("get_ticket", 200, None, False, False) in seen
            assert ("get_ticket", 404, "TICKET_NOT_FOUND", False, False) in seen
            assert ("list_tickets", 200, None, False, False) in seen
            assert all(l.vendorName and l.clientId == crm.client_id for l in logs)
            assert any(l.ticketId for l in logs if l.reference == ref)

            # ── no secret, token or personal detail anywhere in what is stored ─
            blob = " ".join(l.model_dump_json() for l in logs)
            for leaked in (
                crm.client_secret,
                crm.access,
                crm.refresh,
                "Bearer",
                "CRM Customer",
                "Green Park",
            ):
                assert leaked not in blob, leaked
            stored = await db.scalars(
                select(IntegrationCallLog.detail).where(IntegrationCallLog.credential_id == crm.credential_id)
            )
            for detail in stored:
                assert "sk_live_" not in str(detail)
            masked = next(l.summary for l in logs if l.summary and "customerPhone" in l.summary)
            assert masked["customerPhone"].startswith("+91XXXXXX")

            # ── filters ───────────────────────────────────────────────────
            errors, _ = await cred_service.list_logs(
                db, admin, ListParams(limit=100), credential_id=crm.credential_id, outcome="error"
            )
            assert errors and all(l.httpStatus >= 400 for l in errors)
            only_list, _ = await cred_service.list_logs(
                db, admin, ListParams(limit=100), credential_id=crm.credential_id, endpoint="list_tickets"
            )
            assert only_list and {l.endpoint for l in only_list} == {"list_tickets"}
            nothing, n = await cred_service.list_logs(
                db, admin, ListParams(limit=100), endpoint="not-an-endpoint"
            )
            assert nothing == [] and n == 0

            # ── another company's Admin sees none of it ───────────────────
            other = await seed_task05._principal_for(
                db,
                await seed_task05._user_by_email(db, w.company_b_admin_email),
                w.company_b_id,
            )
            mine, mine_total = await cred_service.list_logs(db, other, ListParams(limit=100))
            assert crm.credential_id not in {l.credentialId for l in mine}

            # ── the Source filter ─────────────────────────────────────────
            api, _ = await tickets_service.list_tickets(db, admin, ListParams(limit=100), source="API")
            assert api and all(t.source == "API" for t in api)
            assert number in {t.code for t in api}
            manual, _ = await tickets_service.list_tickets(db, admin, ListParams(limit=100), source="Manual")
            assert number not in {t.code for t in manual} and all(t.source == "Manual" for t in manual)

            # ── retention: 30 days clears the detail, a year deletes the row ─
            target = next(l for l in logs if l.summary)
            row_id = target.id
            now = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(
                update(IntegrationCallLog)
                .where(IntegrationCallLog.id == row_id)
                .values(created_at=now - datetime.timedelta(days=31))
            )
            await db.commit()
            await sweep_api_log_retention(db)
            await db.commit()
            kept = await db.scalar(
                select(IntegrationCallLog).where(IntegrationCallLog.id == row_id).execution_options(populate_existing=True)
            )
            assert kept is not None and kept.detail is None  # row stays, details gone
            again, _ = await cred_service.list_logs(db, admin, ListParams(limit=100), credential_id=crm.credential_id)
            assert next(l for l in again if l.id == row_id).summary is None

            await sweep_api_log_retention(db)  # idempotent
            await db.commit()
            assert await db.scalar(select(IntegrationCallLog.id).where(IntegrationCallLog.id == row_id)) == row_id

            await db.execute(
                update(IntegrationCallLog)
                .where(IntegrationCallLog.id == row_id)
                .values(created_at=now - datetime.timedelta(days=366))
            )
            old_token = await db.scalar(
                select(ApiRefreshToken.id).where(ApiRefreshToken.credential_id == crm.credential_id).limit(1)
            )
            await db.execute(
                update(ApiRefreshToken)
                .where(ApiRefreshToken.id == old_token)
                .values(expires_at=now - datetime.timedelta(days=31))
            )
            await db.commit()
            await sweep_api_log_retention(db)
            await db.commit()
            assert await db.scalar(select(IntegrationCallLog.id).where(IntegrationCallLog.id == row_id)) is None
            assert await db.scalar(select(ApiRefreshToken.id).where(ApiRefreshToken.id == old_token)) is None

    asyncio.run(go())
