"""Customer location on the customer link — quickstart scenarios 1-4.

Driven against the dev database through the real page routes (ASGI, no network),
on the cast `seed_task05` builds. Run with:

    cd api
    .venv/Scripts/python.exe -m pytest tests/integration/test_customer_location.py -v
"""

import asyncio
import datetime
import sys
import uuid

import httpx
import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.slots import bookable_slots  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import TicketCreateRequest  # noqa: E402
from app.main import app  # noqa: E402
from app.models.technician import TechnicianPincode  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402

HYDERABAD = ("17.385044", "78.486671")
OUTSIDE_INDIA = ("51.5", "-0.12")


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def _fresh(db, ticket_id: uuid.UUID) -> Ticket:
    return await db.get(Ticket, ticket_id, populate_existing=True)


async def _events(db, ticket_id: uuid.UUID, kind: str) -> list[TicketEvent]:
    return list(
        await db.scalars(
            select(TicketEvent).where(
                TicketEvent.ticket_id == ticket_id, TicketEvent.kind == kind
            )
        )
    )


async def _fixed_time_ticket(db, w, index: int) -> Ticket:
    """A ticket raised WITH its time already agreed."""
    ravi = await t05.profile(db, w, "ravi")
    pending = await t05.raise_ticket(db, w, ravi, index=index, confirm=False)
    start, end = (await bookable_slots(db, pending))[0]
    codes = list(
        await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.technician_id == ravi.id
            )
        )
    )
    body = TicketCreateRequest(
        subcategoryId=w.leaf_id,
        modelId=w.model_id,
        serviceType=w.service_types[0],
        serialNumber=f"CL{index:06d}{uuid.uuid4().hex[:4].upper()}",
        customerName="Fixed Time Customer",
        customerPhone=t05._phone(60_000 + index),
        address=f"Flat {index}, Green Park Residency",
        city="Hyderabad",
        state="Telangana",
        pincode=codes[0],
        expectedDate=datetime.datetime.now(datetime.timezone.utc).date()
        + datetime.timedelta(days=1),
        serviceLevelHours=48,
        slotStart=start,
        slotEnd=end,
    )
    created = await tickets_service.create_ticket(db, await t05.p(db, "vendor"), body)
    return await db.get(Ticket, created.id)


def test_scenario_1_slot_pending_sets_time_and_location() -> None:
    w = t05.world()  # builds on its own loop, so before ours starts

    async def go() -> None:
        async with AsyncSessionLocal() as db, client() as http:
            ravi = await t05.profile(db, w, "ravi")
            row = await t05.raise_ticket(db, w, ravi, index=910, confirm=False)
            assert row.slot_token and row.location_source is None
            token, tid = row.slot_token, row.id

            page = await http.get(f"/slot/{token}")
            assert "Where should we come?" in page.text
            assert 'name="start"' in page.text
            # The address search and the far-away warning are on the page.
            assert 'id="loc-q"' in page.text and 'data-far="' in page.text

            start = (await bookable_slots(db, row))[0][0]
            done = await http.post(
                f"/slot/{token}",
                data={"start": start.isoformat(), "lat": HYDERABAD[0], "lng": HYDERABAD[1]},
            )
            assert "all set" in done.text and "Your location is saved." in done.text
            # Saved: shown read-only, with the point, and nothing to change it.
            assert 'data-readonly="1"' in done.text
            assert 'data-lat="17.385044"' in done.text
            assert 'id="loc-save"' not in done.text

            row = await _fresh(db, tid)
            assert row.slot_start is not None
            assert row.location_source == "customer"
            assert (row.latitude, row.longitude) == (17.385044, 78.486671)
            assert len(await _events(db, tid, "location_set")) == 1

            # Locked: a second save is refused and the point does not move.
            again = await http.post(
                f"/slot/{token}/location", data={"lat": "17.5", "lng": "78.5"}
            )
            assert again.status_code == 200
            assert (await _fresh(db, tid)).latitude == 17.385044

    asyncio.run(go())


def test_scenario_2_fixed_time_gets_a_link_and_cannot_change_the_time() -> None:
    w = t05.world()  # builds on its own loop, so before ours starts

    async def go() -> None:
        async with AsyncSessionLocal() as db, client() as http:
            row = await _fixed_time_ticket(db, w, 911)
            assert row.slot_token and row.slot_start is not None
            token, tid, was = row.slot_token, row.id, row.slot_start
            # The receipt is attempted at intake (with the link once its
            # template is configured), and never a slot REQUEST.
            assert len(await _events(db, tid, "confirmation_sent")) == 1
            assert row.slot_request_status == "not_needed"

            page = await http.get(f"/slot/{token}")
            assert "Your visit is booked" in page.text
            assert "Where should we come?" in page.text
            assert 'name="start"' not in page.text  # the time is read-only

            # A forged time pick is refused; the time stays.
            other = was + datetime.timedelta(days=1)
            await http.post(f"/slot/{token}", data={"start": other.isoformat()})
            assert (await _fresh(db, tid)).slot_start == was

            saved = await http.post(
                f"/slot/{token}/location",
                data={"lat": HYDERABAD[0], "lng": HYDERABAD[1]},
            )
            assert "Your location is saved." in saved.text
            row = await _fresh(db, tid)
            assert row.location_source == "customer" and row.slot_start == was

    asyncio.run(go())


def test_scenario_3_skipping_the_location_keeps_the_default() -> None:
    w = t05.world()  # builds on its own loop, so before ours starts

    async def go() -> None:
        async with AsyncSessionLocal() as db, client() as http:
            ravi = await t05.profile(db, w, "ravi")
            row = await t05.raise_ticket(db, w, ravi, index=912, confirm=False)
            token, tid = row.slot_token, row.id
            start = (await bookable_slots(db, row))[0][0]
            await http.post(f"/slot/{token}", data={"start": start.isoformat()})

            row = await _fresh(db, tid)
            assert row.slot_start is not None and row.location_source is None

            # Still offered after the time was picked, until somebody accepts.
            page = await http.get(f"/slot/{token}")
            assert "Where should we come?" in page.text

    asyncio.run(go())


def test_scenario_4_refusals() -> None:
    w = t05.world()  # builds on its own loop, so before ours starts

    async def go() -> None:
        async with AsyncSessionLocal() as db, client() as http:
            row = await _fixed_time_ticket(db, w, 913)
            token, tid = row.slot_token, row.id

            bad = await http.post(
                f"/slot/{token}/location",
                data={"lat": OUTSIDE_INDIA[0], "lng": OUTSIDE_INDIA[1]},
            )
            assert "outside India" in bad.text
            assert (await _fresh(db, tid)).location_source is None

            ravi = await t05.profile(db, w, "ravi")
            await t05.accept_job(db, w, ravi, await _fresh(db, tid))
            late = await http.post(
                f"/slot/{token}/location",
                data={"lat": HYDERABAD[0], "lng": HYDERABAD[1]},
            )
            assert late.status_code == 200
            row = await _fresh(db, tid)
            assert row.location_source is None  # a held job is never moved

    asyncio.run(go())


def test_scenario_6_staff_correction() -> None:
    from fastapi import HTTPException

    w = t05.world()

    async def go() -> None:
        async with AsyncSessionLocal() as db:
            row = await _fixed_time_ticket(db, w, 914)
            tid = row.id

            admin = await t05.p(db, "admin")
            data, held = await tickets_service.correct_location(
                db, admin, tid,
                latitude=17.4, longitude=78.4, reason="Customer rang with the right pin",
            )
            assert not held
            assert data.locationSource == "staff" and data.latitude == 17.4
            events = await _events(db, tid, "location_set")
            assert len(events) == 1 and "Customer rang" in (events[0].note or "")

            # Another company's staff cannot even see it.
            from app.scripts import seed_task05

            other = await seed_task05._principal_for(
                db,
                await seed_task05._user_by_email(db, w.company_b_admin_email),
                w.company_b_id,
            )
            with pytest.raises((HTTPException, Exception)) as err:
                await tickets_service.correct_location(
                    db, other, tid, latitude=17.4, longitude=78.4, reason="nope"
                )
            assert getattr(err.value, "status_code", None) == 404

            # A franchise login is refused outright.
            franchise = await t05.p(db, "bala")
            with pytest.raises(HTTPException) as no:
                await tickets_service.correct_location(
                    db, franchise, tid, latitude=17.4, longitude=78.4, reason="x"
                )
            assert no.value.status_code in (403, 404)

            # A staff point is not overwritten by the customer's link.
            async with client() as http:
                await http.post(
                    f"/slot/{row.slot_token}/location",
                    data={"lat": HYDERABAD[0], "lng": HYDERABAD[1]},
                )
            assert (await _fresh(db, tid)).location_source == "staff"

            # Outside India is refused.
            with pytest.raises(Exception) as bad:
                await tickets_service.correct_location(
                    db, admin, tid, latitude=51.5, longitude=-0.1, reason="x"
                )
            assert getattr(bad.value, "status_code", None) == 400

    asyncio.run(go())
