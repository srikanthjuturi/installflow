"""Vendor CRM API — following its tickets (quickstart Scenario 5).

    cd api
    DB_POOL_SIZE=6 DB_MAX_OVERFLOW=4 .venv/Scripts/python.exe -m pytest tests/integration/test_vendor_crm_tracking.py -v
"""

import asyncio
import datetime
import json
import re
import sys
import uuid

from sqlalchemy import select, update

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.slots import bookable_slots  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from tests.integration import test_task05_acceptance as t05  # noqa: E402
from tests.integration.crm_support import TICKETS, crm_fixture  # noqa: E402

#: Words a CRM-facing key must never contain. `reference` is fine; `phone` is not.
FORBIDDEN_KEY = re.compile(
    r"phone|mobile|payout|price|paise|amount|charge|credit|note|reason|link|token|"
    r"franchisee|latitude|longitude|lat$|lng$|address|serial|upi|ledger",
    re.I,
)


def _keys(node) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            found.append(k)
            found.extend(_keys(v))
    elif isinstance(node, list):
        for item in node:
            found.extend(_keys(item))
    return found


def _assert_clean(response_text: str) -> None:
    body = json.loads(response_text)
    bad = [k for k in _keys(body) if FORBIDDEN_KEY.search(k)]
    assert not bad, bad
    # no phone number of anybody, in any form
    assert not re.search(r"\+?\d{10,}", response_text), "a phone-like number leaked"
    assert "/slot/" not in response_text and "http" not in response_text.lower()


async def _collect(crm, params: dict, *, limit: int = 200, max_pages: int = 60) -> list[dict]:
    """Every item for `params`, following `nextCursor` — the way a CRM must."""
    items: list[dict] = []
    cursor = None
    for _ in range(max_pages):
        q = {**params, "limit": limit}
        if cursor:
            q["cursor"] = cursor
        r = await crm.http.get(TICKETS, params=q, headers=crm.auth)
        assert r.status_code == 200, r.text
        page = r.json()["data"]
        items.extend(page["items"])
        cursor = page["nextCursor"]
        if cursor is None:
            return items
    raise AssertionError("more pages than a test should ever need")


def test_crm_follows_its_tickets() -> None:
    w = t05.world()

    async def go() -> None:
        async with crm_fixture(w) as crm:
            db = crm.db
            ravi = await t05.profile(db, w, "ravi")
            since_start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2)

            ref = f"CRM-{uuid.uuid4().hex[:8]}"
            created = await crm.post(crm.payload(ref))
            assert created.status_code == 201
            number = created.json()["data"]["ticketNumber"]
            ticket = await db.scalar(select(Ticket).where(Ticket.code == number))

            # ── one ticket, by reference and by our number ────────────────
            by_ref = await crm.http.get(f"{TICKETS}/{ref}", headers=crm.auth)
            by_code = await crm.http.get(f"{TICKETS}/{number}", headers=crm.auth)
            assert by_ref.status_code == by_code.status_code == 200
            assert by_ref.json()["data"] == by_code.json()["data"]
            view = by_ref.json()["data"]
            assert view["ticketNumber"] == number and view["reference"] == ref
            assert view["status"] == "Slot Pending" and view["technician"] is None
            assert view["visit"] is None and view["feedback"] is None
            assert [e["kind"] for e in view["timeline"]][:1] == ["created"]
            _assert_clean(by_ref.text)

            # ── the customer picks a time, a technician takes it ──────────
            start = (await bookable_slots(db, ticket))[0][0]
            await tickets_service.confirm_slot(db, ticket.slot_token, start)
            ticket = await db.scalar(
                select(Ticket).where(Ticket.id == ticket.id).execution_options(populate_existing=True)
            )
            await t05.accept_job(db, w, ravi, ticket)
            after_accept = (await crm.http.get(f"{TICKETS}/{ref}", headers=crm.auth)).json()["data"]
            assert after_accept["visit"]["chosenByCustomer"] is True
            assert after_accept["technician"] and list(after_accept["technician"]) == ["name"]
            assert after_accept["status"] in ("Assigned", "New")
            kinds = [e["kind"] for e in after_accept["timeline"]]
            assert "slot_confirmed" in kinds and "assigned" in kinds
            _assert_clean(json.dumps(after_accept))

            # ── work done and the customer answers ────────────────────────
            await t05.customer_close(db, w, ticket, rating=4)
            done = await crm.http.get(f"{TICKETS}/{ref}", headers=crm.auth)
            data = done.json()["data"]
            assert data["status"] == "Closed"
            assert data["feedback"] and data["feedback"]["rating"] == 4
            kinds = [e["kind"] for e in data["timeline"]]
            assert "completed" in kinds and "feedback_received" in kinds
            _assert_clean(done.text)

            # ── another vendor's ticket, and a made-up one: not found ─────
            foreign = await db.scalar(
                select(Ticket).where(Ticket.vendor_id != w.vendor_id).limit(1)
            )
            assert foreign is not None, "the dev database should hold other vendors' tickets"
            for ident in (foreign.code, foreign.external_ref or foreign.code, "NO-SUCH-TICKET"):
                missing = await crm.http.get(f"{TICKETS}/{ident}", headers=crm.auth)
                assert missing.status_code == 404 and missing.json()["code"] == "TICKET_NOT_FOUND"

            # ── changed since ─────────────────────────────────────────────
            params = {"changedSince": since_start.isoformat()}
            first = await crm.http.get(TICKETS, params={**params, "limit": 5}, headers=crm.auth)
            assert first.status_code == 200, first.text
            _assert_clean(first.text)
            items = await _collect(crm, params)
            assert number in [i["ticketNumber"] for i in items]
            own_codes = set(
                await db.scalars(select(Ticket.code).where(Ticket.vendor_id == w.vendor_id))
            )
            assert {i["ticketNumber"] for i in items} <= own_codes  # nobody else's
            assert all(i["timeline"] is None for i in items)  # only on request
            with_tl = await crm.http.get(
                TICKETS, params={**params, "include": "timeline", "limit": 5}, headers=crm.auth
            )
            assert any(i["timeline"] for i in with_tl.json()["data"]["items"])

            # a ticket that changed ONLY by a new history entry still shows up
            quiet = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"))
            quiet_no = quiet.json()["data"]["ticketNumber"]
            quiet_row = await db.scalar(select(Ticket).where(Ticket.code == quiet_no))
            long_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)
            await db.execute(update(Ticket).where(Ticket.id == quiet_row.id).values(updated_at=long_ago))
            # ...and its own history is old too
            await db.execute(
                update(TicketEvent).where(TicketEvent.ticket_id == quiet_row.id).values(created_at=long_ago)
            )
            await db.commit()
            recent = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)).isoformat()
            before = await _collect(crm, {"changedSince": recent})
            assert quiet_no not in [i["ticketNumber"] for i in before]
            quiet_row = await db.scalar(select(Ticket).where(Ticket.id == quiet_row.id).execution_options(populate_existing=True))
            db.add(
                tickets_service.record_event(
                    quiet_row,
                    "reminded",
                    actor_kind="system",
                    actor_label="test",
                    note="Call +919876543210 about the visit",
                )
            )
            await db.commit()
            after = await _collect(crm, {"changedSince": recent})
            assert quiet_no in [i["ticketNumber"] for i in after]
            # …and that event's note is never sent
            detail = await crm.http.get(f"{TICKETS}/{quiet_no}", headers=crm.auth)
            assert "9876543210" not in detail.text and "reminded" not in detail.text

            # ── paging returns each ticket exactly once ───────────────────
            mark = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
            fresh = []
            for _ in range(3):
                r = await crm.post(crm.payload(f"CRM-{uuid.uuid4().hex[:8]}"))
                fresh.append(r.json()["data"]["ticketNumber"])
            seen: list[str] = []
            cursor = None
            for _ in range(200):
                q = {"changedSince": mark.isoformat(), "limit": 1}
                if cursor:
                    q["cursor"] = cursor
                page = (await crm.http.get(TICKETS, params=q, headers=crm.auth)).json()["data"]
                seen.extend(i["ticketNumber"] for i in page["items"])
                cursor = page["nextCursor"]
                if cursor is None:
                    break
            assert len(seen) == len(set(seen)), "a ticket came twice"
            assert set(fresh) <= set(seen), "a ticket was skipped"
            unpaged = await _collect(crm, {"changedSince": mark.isoformat()})
            assert sorted(seen) == sorted(i["ticketNumber"] for i in unpaged)

            # bad input is a validation error, not a 500
            bad = await crm.http.get(TICKETS, params={"changedSince": "yesterday"}, headers=crm.auth)
            assert bad.status_code == 422 and bad.json()["code"] == "VALIDATION_ERROR"
            badc = await crm.http.get(
                TICKETS, params={"changedSince": recent, "cursor": "nope"}, headers=crm.auth
            )
            assert badc.status_code == 422

    asyncio.run(go())
