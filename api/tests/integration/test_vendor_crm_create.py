"""Vendor CRM API — creating a ticket (quickstart Scenario 3, and the repeat/check-only rules).

One credential, driven over the real HTTP routes (ASGI, no network), against the
cast `seed_task05` builds. The seeded product gets a temporary SKU (and later its
original one back). Run with:

    cd api
    DB_POOL_SIZE=4 DB_MAX_OVERFLOW=2 .venv/Scripts/python.exe -m pytest tests/integration/test_vendor_crm_create.py -v
"""

import asyncio
import dataclasses
import datetime
import sys
import uuid

import httpx
from sqlalchemy import func, select, update

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.credits import balance as credit_balance  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.slots import bookable_slots  # noqa: E402
from app.features.api_credentials import service as cred_service  # noqa: E402
from app.features.api_credentials.schemas import ApiCredentialCreateRequest  # noqa: E402
from app.features.masters import service as masters_service  # noqa: E402
from app.features.masters.schemas import ModelUpdateRequest  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.main import app  # noqa: E402
from app.models.product import ProductModel  # noqa: E402
from app.models.technician import TechnicianPincode  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402

TOKEN = "/api/v1/integration/token"
TICKETS = "/api/v1/integration/tickets"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def _ticket(db, reference: str) -> Ticket | None:
    return await db.scalar(
        select(Ticket)
        .where(func.lower(Ticket.external_ref) == reference.lower())
        .execution_options(populate_existing=True)
    )


async def _count(db, reference: str) -> int:
    return await db.scalar(
        select(func.count()).select_from(Ticket).where(
            func.lower(Ticket.external_ref) == reference.lower()
        )
    )


async def _events(db, ticket_id: uuid.UUID) -> list[TicketEvent]:
    return list(
        await db.scalars(
            select(TicketEvent)
            .where(TicketEvent.ticket_id == ticket_id)
            .order_by(TicketEvent.seq)
        )
    )


def test_crm_creates_tickets() -> None:
    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db, client() as http:
            admin = await t05.p(db, "admin")
            ravi = await t05.profile(db, w, "ravi")
            await t05.ensure_vendor_headroom(db)
            codes = list(
                await db.scalars(
                    select(TechnicianPincode.pincode).where(
                        TechnicianPincode.technician_id == ravi.id
                    )
                )
            )
            pincode = codes[0]

            await db.execute(
                update(Vendor)
                .where(Vendor.id == w.vendor_id)
                .values(intake_channels=["API", "Manual", "Excel"])
            )
            await db.commit()

            model = await db.get(ProductModel, w.model_id)
            old_sku, old_types = model.sku, list(model.service_types)
            vendor_limit = await db.scalar(
                select(Vendor.credit_limit_paise).where(Vendor.id == w.vendor_id)
            )
            sku = f"CRM-{uuid.uuid4().hex[:8].upper()}"
            await masters_service.update_model(
                db, admin, w.model_id, ModelUpdateRequest(sku=sku)
            )
            model_price = (
                await db.scalar(
                    select(ProductModel.vendor_price_paise).where(ProductModel.id == w.model_id)
                )
            )
            made = await cred_service.create_credential(
                db, admin, ApiCredentialCreateRequest(vendorId=w.vendor_id)
            )
            try:
                tok = await http.post(
                    TOKEN,
                    json={"clientId": made.credential.clientId, "clientSecret": made.clientSecret},
                )
                access = tok.json()["data"]["accessToken"]
                auth = {"Authorization": f"Bearer {access}"}
                today = datetime.datetime.now(datetime.timezone.utc).date()
                counter = [0]

                def payload(reference: str, **over) -> dict:
                    counter[0] += 1
                    body = {
                        "reference": reference,
                        "customerName": "CRM Customer",
                        "customerPhone": t05._phone(71_000 + counter[0] + uuid.uuid4().int % 500),
                        "address": "Flat 9, Green Park Residency",
                        "city": "Hyderabad",
                        "state": "Telangana",
                        "pincode": pincode,
                        "sku": sku,
                        "serialNumber": f"CRM{uuid.uuid4().hex[:8].upper()}",
                        "serviceType": "Installation + Demo",
                        "expectedDate": (today + datetime.timedelta(days=1)).isoformat(),
                    }
                    body.update(over)
                    return body

                async def post(body: dict):
                    return await http.post(TICKETS, json=body, headers=auth)

                # ── 1. a complete request, no visit time ──────────────────
                ref1 = f"CRM-{uuid.uuid4().hex[:8]}"
                before = await credit_balance(db, w.company_a_id)
                r1 = await post(payload(ref1))
                assert r1.status_code == 201, r1.text
                data = r1.json()["data"]
                assert data["status"] == "Slot Pending" and data["repeat"] is False
                assert data["ticketNumber"] and data["reference"] == ref1
                # no franchisee, no private link, no slot token in the reply
                text = r1.text.lower()
                assert "franchisee" not in text and "/slot/" not in text and "slot_token" not in text

                t1 = await _ticket(db, ref1)
                assert t1.source == "API" and t1.created_by == made.credential.id
                assert t1.vendor_id == w.vendor_id and t1.company_id == w.company_a_id
                assert t1.vendor_price_paise == model_price  # the product's price, stamped
                assert t1.service_level_hours == 24 and t1.franchisee_id is not None
                kinds = [(e.kind, e.actor_kind) for e in await _events(db, t1.id)]
                assert ("created", "system") in kinds and ("slot_requested", "system") in kinds
                created = next(e for e in await _events(db, t1.id) if e.kind == "created")
                assert created.actor_label.startswith("API (")
                after = await credit_balance(db, w.company_a_id)
                charge = before - after
                assert charge > 0  # charged once

                # ── 2. the same reference again: a repeat, nothing new ────
                again = await post(payload(ref1))
                assert again.status_code == 200 and again.json()["data"]["repeat"] is True
                assert again.json()["data"]["ticketNumber"] == data["ticketNumber"]
                upper = await post(payload(ref1.upper()))
                assert upper.json()["data"]["repeat"] is True  # case does not matter
                assert await _count(db, ref1) == 1
                assert await credit_balance(db, w.company_a_id) == after

                # ── 3. what the CRM must not decide is ignored ────────────
                ref2 = f"CRM-{uuid.uuid4().hex[:8]}"
                other_franchisee = uuid.uuid4()
                r2 = await post(
                    payload(
                        ref2,
                        franchiseeId=str(other_franchisee),
                        vendorPricePaise=1,
                        vendorId=str(uuid.uuid4()),
                        companyId=str(uuid.uuid4()),
                        serviceLevelHours=48,
                    )
                )
                assert r2.status_code == 201, r2.text
                t2 = await _ticket(db, ref2)
                assert t2.franchisee_id != other_franchisee
                assert t2.vendor_price_paise == model_price
                assert t2.service_level_hours == 24 and t2.vendor_id == w.vendor_id

                # ── 4. a fixed visit time: confirmed, no slot request ─────
                pending = await t05.raise_ticket(db, w, ravi, index=930, confirm=False)
                start, end = (await bookable_slots(db, pending))[0]
                ref3 = f"CRM-{uuid.uuid4().hex[:8]}"
                r3 = await post(payload(ref3, visitStart=start.isoformat(), visitEnd=end.isoformat()))
                assert r3.status_code == 201, r3.text
                assert r3.json()["data"]["status"] == "New"
                t3 = await _ticket(db, ref3)
                assert t3.slot_start is not None and t3.slot_request_status == "not_needed"
                assert "confirmation_sent" in [e.kind for e in await _events(db, t3.id)]

                # ── 5. refusals: the code, and nothing created ────────────
                async def refused(body: dict, code: str, status: int) -> None:
                    ref = body["reference"]
                    r = await post(body)
                    assert r.status_code == status and r.json()["code"] == code, r.text
                    assert await _count(db, ref) == 0

                products_before = await db.scalar(
                    select(func.count()).select_from(ProductModel).where(ProductModel.vendor_id == w.vendor_id)
                )
                await refused(payload(f"CRM-{uuid.uuid4().hex[:8]}", sku="NO-SUCH-SKU"), "UNKNOWN_SKU", 400)
                assert (
                    await db.scalar(
                        select(func.count()).select_from(ProductModel).where(ProductModel.vendor_id == w.vendor_id)
                    )
                ) == products_before  # the API never creates a product
                await refused(payload(f"CRM-{uuid.uuid4().hex[:8]}", pincode="999999"), "UNKNOWN_PINCODE", 400)
                yesterday = (today - datetime.timedelta(days=2)).isoformat()
                await refused(payload(f"CRM-{uuid.uuid4().hex[:8]}", expectedDate=yesterday), "EXPECTED_DATE_PASSED", 400)

                bad = await post({"reference": f"CRM-{uuid.uuid4().hex[:8]}", "sku": sku})
                assert bad.status_code == 422 and bad.json()["code"] == "VALIDATION_ERROR"
                assert any("customerName" in e for e in bad.json()["errors"])
                notjson = await http.post(TICKETS, content=b"not json", headers=auth)
                assert notjson.status_code == 422 and notjson.json()["code"] == "VALIDATION_ERROR"
                noauth = await http.post(TICKETS, json=payload("x"))
                assert noauth.status_code == 401 and noauth.json()["code"] == "TOKEN_INVALID"

                # a visit type the product does not support
                await masters_service.update_model(
                    db, admin, w.model_id, ModelUpdateRequest(serviceTypes=["Installation + Demo"])
                )
                await refused(
                    payload(f"CRM-{uuid.uuid4().hex[:8]}", serviceType="Uninstall"),
                    "SERVICE_TYPE_NOT_SUPPORTED",
                    400,
                )
                await masters_service.update_model(
                    db, admin, w.model_id, ModelUpdateRequest(serviceTypes=old_types)
                )
                # Service needs a description, Installation must not have one
                needs = await post(payload(f"CRM-{uuid.uuid4().hex[:8]}", serviceType="Service"))
                assert needs.status_code == 422 and needs.json()["code"] == "VALIDATION_ERROR"

                # the vendor's own credit line
                await db.execute(
                    update(Vendor).where(Vendor.id == w.vendor_id).values(credit_limit_paise=0)
                )
                await db.commit()
                await refused(
                    payload(f"CRM-{uuid.uuid4().hex[:8]}"), "VENDOR_OUT_OF_CREDITS", 409
                )
                await db.execute(
                    update(Vendor).where(Vendor.id == w.vendor_id).values(credit_limit_paise=vendor_limit)
                )
                await db.commit()

                # ── 6. check only: everything validated, nothing made ─────
                ref4 = f"CRM-{uuid.uuid4().hex[:8]}"
                balance_before = await credit_balance(db, w.company_a_id)
                tickets_before = await db.scalar(select(func.count()).select_from(Ticket))
                chk = await post(payload(ref4, checkOnly=True))
                assert chk.status_code == 200, chk.text
                assert chk.json()["data"]["wouldCreate"] is True and chk.json()["data"]["ticketNumber"] is None
                assert await _count(db, ref4) == 0
                assert await credit_balance(db, w.company_a_id) == balance_before
                assert await db.scalar(select(func.count()).select_from(Ticket)) == tickets_before
                # …and a check-only refusal is the real refusal
                chk_bad = await post(payload(f"CRM-{uuid.uuid4().hex[:8]}", sku="NO-SUCH-SKU", checkOnly=True))
                assert chk_bad.status_code == 400 and chk_bad.json()["code"] == "UNKNOWN_SKU"
                # …the reference was NOT used up
                real = await post(payload(ref4))
                assert real.status_code == 201 and real.json()["data"]["repeat"] is False
                # …and check-only against a used reference says it is a repeat
                chk_repeat = await post(payload(ref4, checkOnly=True))
                assert chk_repeat.json()["data"]["repeat"] is True

                # ── 7. who can see an API ticket ──────────────────────────
                vendor = await t05.p(db, "vendor")
                seen = await tickets_service.get_ticket(db, vendor, t1.id)
                assert seen.code == t1.code
                sub_user = dataclasses.replace(vendor, role="vendor_user")
                try:
                    await tickets_service.get_ticket(db, sub_user, t1.id)
                    raise AssertionError("a vendor sub-user must not see an API ticket")
                except Exception as exc:  # noqa: BLE001
                    assert getattr(exc, "status_code", None) == 404
                staff_sees = await tickets_service.get_ticket(db, admin, t1.id)
                assert staff_sees.code == t1.code
            finally:
                await db.rollback()
                await db.refresh(admin.user)  # a rollback expires it; revoke reads its id
                await cred_service.revoke_credential(db, admin, made.credential.id)
                await masters_service.update_model(
                    db, admin, w.model_id, ModelUpdateRequest(serviceTypes=old_types)
                )
                await masters_service.update_model(
                    db, admin, w.model_id, ModelUpdateRequest(sku=old_sku)
                )
                await db.execute(
                    update(Vendor).where(Vendor.id == w.vendor_id).values(credit_limit_paise=vendor_limit)
                )
                await db.commit()
                await t05.ensure_vendor_headroom(db)

    asyncio.run(go())
