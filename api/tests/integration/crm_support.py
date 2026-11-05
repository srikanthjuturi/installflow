"""Shared setup for the vendor CRM API integration tests.

`crm_fixture` gives a test an API-enabled vendor, a temporary SKU on the seeded
product, a fresh credential and its bearer headers — and puts every one of them
back afterwards, whatever the test did.
"""

import contextlib
import datetime
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx
from sqlalchemy import select, update

from app.core.database import AsyncSessionLocal
from app.features.api_credentials import service as cred_service
from app.features.api_credentials.schemas import ApiCredentialCreateRequest
from app.features.masters import service as masters_service
from app.features.masters.schemas import ModelUpdateRequest
from app.main import app
from app.models.product import ProductModel
from app.models.technician import TechnicianPincode
from app.models.vendor import Vendor
from tests.integration import test_task05_acceptance as t05

TOKEN = "/api/v1/integration/token"
TICKETS = "/api/v1/integration/tickets"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@dataclass
class Crm:
    db: Any
    http: httpx.AsyncClient
    w: Any
    admin: Any
    sku: str
    pincode: str
    credential_id: uuid.UUID
    client_id: str
    client_secret: str
    access: str
    refresh: str
    auth: dict[str, str]
    payload: Callable[..., dict]
    post: Callable[..., Any]
    extra: dict = field(default_factory=dict)


@contextlib.asynccontextmanager
async def crm_fixture(w):
    async with AsyncSessionLocal() as db, client() as http:
        admin = await t05.p(db, "admin")
        ravi = await t05.profile(db, w, "ravi")
        await t05.ensure_vendor_headroom(db)
        pincode = (
            await db.scalars(
                select(TechnicianPincode.pincode).where(TechnicianPincode.technician_id == ravi.id)
            )
        ).first()
        await db.execute(
            update(Vendor)
            .where(Vendor.id == w.vendor_id)
            .values(intake_channels=["API", "Manual", "Excel"], is_active=True)
        )
        await db.commit()

        model = await db.get(ProductModel, w.model_id)
        old_sku = model.sku
        sku = f"CRM-{uuid.uuid4().hex[:8].upper()}"
        await masters_service.update_model(db, admin, w.model_id, ModelUpdateRequest(sku=sku))
        made = await cred_service.create_credential(
            db, admin, ApiCredentialCreateRequest(vendorId=w.vendor_id)
        )
        tok = await http.post(
            TOKEN, json={"clientId": made.credential.clientId, "clientSecret": made.clientSecret}
        )
        data = tok.json()["data"]
        auth = {"Authorization": f"Bearer {data['accessToken']}"}
        today = datetime.datetime.now(datetime.timezone.utc).date()
        counter = [0]

        def payload(reference: str, **over) -> dict:
            counter[0] += 1
            body = {
                "reference": reference,
                "customerName": "CRM Customer",
                "customerPhone": t05._phone(72_000 + counter[0] + uuid.uuid4().int % 400),
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

        async def post(body: dict, headers: dict | None = None):
            return await http.post(TICKETS, json=body, headers=headers or auth)

        crm = Crm(
            db=db,
            http=http,
            w=w,
            admin=admin,
            sku=sku,
            pincode=pincode,
            credential_id=made.credential.id,
            client_id=made.credential.clientId,
            client_secret=made.clientSecret,
            access=data["accessToken"],
            refresh=data["refreshToken"],
            auth=auth,
            payload=payload,
            post=post,
        )
        try:
            yield crm
        finally:
            await db.rollback()
            await db.refresh(admin.user)
            for c in await cred_service.list_credentials(db, admin, w.vendor_id):
                if c.status == "Active":
                    await cred_service.revoke_credential(db, admin, c.id)
            await masters_service.update_model(db, admin, w.model_id, ModelUpdateRequest(sku=old_sku))
            await db.execute(
                update(Vendor)
                .where(Vendor.id == w.vendor_id)
                .values(intake_channels=["API", "Manual", "Excel"], is_active=True)
            )
            await db.commit()
            await t05.ensure_vendor_headroom(db)
