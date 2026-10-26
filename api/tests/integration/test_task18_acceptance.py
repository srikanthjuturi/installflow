"""Task 18 §7 acceptance (API half) - handing an unassigned ticket to another franchisee,
driven through the SERVICE layer against RelianceDB (dev), the way `test_task12_acceptance.py` and
`test_task17_acceptance.py` run: the cast seeded by `app.scripts.seed_task05`, hand-built `Principal`s,
a fresh session per segment, no HTTP. Run with:

    cd api
    .venv/Scripts/python.exe -m pytest tests/integration/test_task18_acceptance.py -v

**Nothing real leaves the process.** The `.env` carries live WhatsApp, e-mail and push credentials, so a
module fixture empties the tokens on `settings`, switches push off, and replaces the outbound doors the
flows touch with no-ops. Customers, logins and technicians are synthetic (`+911...`, `@seed.example.com`).
The escalation sweep (#15) runs inside a session that is ROLLED BACK, with the area manager's WhatsApp
replaced - it scans the whole shared database and must change none of it.

The cast (find-or-create, tag `T18`): a franchisee **A** (`T18A`, external, with an admin) owning three
codes nobody uses and holding technician **X** (certified, covers only A's codes) and **Xn** (uncertified);
the world's **S** (SkyFix) with a fresh technician **R** covering the ticket pincode **P**; the home **H**
with a fresh technician **Hh**; **D** (inactive), **Z** (active, no technicians - the deactivation test)
and **Q** (given a free code in the carve-out test, then cleared). The tests hand state to one another
through `F`, so run the file top to bottom.

What this file does NOT prove (no HTTP, no devices): the route wiring in a running server (the guard
FUNCTIONS of the real routes are called directly, in order), the `message` strings of the envelope, a
phone receiving the push (`PUSH_ENABLED` is off; the `notified` count is the audience size), two terminals
racing over the wire (the race is two sessions here, interleaved deterministically), and the console
(#22 - see the vitest files).

At the end the module hands every still-handed unassigned ticket back, deletes the `ticket_handed` bells it
wrote and clears the flag on what is left, so the dev database can still walk `downgrade e8a2c5b7d913`.
A run that dies mid-way leaves them: `UPDATE tickets SET routing_override = false` for the T18 tickets and
delete their `ticket_handed` notifications by hand.
"""

import asyncio
import dataclasses
import datetime
import inspect
import random
import subprocess
import sys
import types
import uuid
from pathlib import Path

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from sqlalchemy import delete, func, select, text, update  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.core import franchise_handover as fh  # noqa: E402
from app.core import franchise_logins  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.coverage import technicians_by_franchisee, technicians_covering  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import Principal  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.core.franchise import franchisee_for_pincode, restamp_ticket  # noqa: E402
from app.core.realtime import PoolChanged  # noqa: E402
from app.core.schemas import ListParams  # noqa: E402
from app.features.franchisees import service as franchisees_service  # noqa: E402
from app.features.franchisees.schemas import (  # noqa: E402
    FranchiseeAdminIn,
    FranchiseeCreateRequest,
    PincodesRequest,
)
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.jobs.ws import _Coverage  # noqa: E402
from app.features.notifications import service as notif_service  # noqa: E402
from app.features.technicians import service as tech_service  # noqa: E402
from app.features.technicians.schemas import TechnicianCreateRequest  # noqa: E402
from app.features.tickets import feedback_service  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets import sweeps as ticket_sweeps  # noqa: E402
from app.features.tickets.router import router as tickets_router  # noqa: E402
from app.features.tickets.schemas import TicketCreateRequest  # noqa: E402
from app.core.vendor_credits import standing as vendor_standing  # noqa: E402
from app.models.franchisee import Franchisee, FranchiseePincode  # noqa: E402
from app.models.ledger import LedgerEntry  # noqa: E402
from app.models.notification import NOTIFICATION_KINDS, Notification  # noqa: E402
from app.models.technician import TechnicianNode, TechnicianPincode, TechnicianProfile  # noqa: E402
from app.models.territory import Pincode  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from app.scripts import audit_tenancy, cleanup_db, seed_task05  # noqa: E402
from tests.integration.test_task05_acceptance import settle_open_jobs  # noqa: E402
from app.scripts.seed import verify as seed_verify  # noqa: E402
from app.scripts.seed.guards import synthetic_email, synthetic_phone  # noqa: E402
from app.scripts.seed.lifecycle import _artifacts as seed_artifacts  # noqa: E402
from app.scripts.seed.tenant import phone_block  # noqa: E402

API_DIR = Path(__file__).resolve().parents[2]

# ── nothing real leaves the process ──────────────────────────────────────────

TECHS: list[uuid.UUID] = []  # every technician this run created
TICKETS: list[uuid.UUID] = []  # every ticket this run raised


@pytest.fixture(scope="module", autouse=True)
def _no_real_sends():
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "WHATSAPP_TOKEN", "")
    mp.setattr(settings, "PUSH_ENABLED", False)
    mp.setattr(settings, "WEB_PUSH_ENABLED", False)
    mp.setattr(settings, "ACS_CONNECTION_STRING", "")

    async def _mail(**_kw):
        return types.SimpleNamespace(ok=True, error=None)

    async def _nothing(*_a, **_k):
        return None

    mp.setattr(franchise_logins, "send_temporary_password", _mail)
    mp.setattr(jobs_service, "_send_feedback_request", _nothing)
    yield
    try:
        settle_open_jobs(TECHS)
    finally:
        mp.undo()
    asyncio.run(_tidy())


async def _tidy() -> None:
    """Leave the dev database able to walk the migration back down."""
    if not TICKETS:
        return
    async with AsyncSessionLocal() as db:
        handed = [
            (r.id, r.company_id, r.pincode, r.franchisee_id)
            for r in (
                await db.execute(
                    select(Ticket.id, Ticket.company_id, Ticket.pincode, Ticket.franchisee_id).where(
                        Ticket.id.in_(TICKETS),
                        Ticket.routing_override.is_(True),
                        Ticket.technician_id.is_(None),
                        Ticket.status.in_(fh.HANDOVER_STATUSES),
                    )
                )
            ).all()
        ]
    for tid, company_id, pincode, stamped in handed:
        # A fresh session and principal per ticket: a refusal rolls back and expires everything.
        async with AsyncSessionLocal() as db:
            owner = await franchisee_for_pincode(db, company_id, pincode)
            if owner == stamped:
                continue
            try:
                admin = await seed_task05._principal_for(
                    db,
                    await seed_task05._user_by_email(db, world().company_a_admin_email),
                    world().company_a_id,
                )
                await tickets_service.hand_to_franchisee(
                    db, admin, tid, franchisee_id=owner, reason="T18 acceptance tidy-up"
                )
            except Exception:  # noqa: BLE001 - the SQL below is the backstop
                await db.rollback()
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(Notification).where(
                Notification.kind == "ticket_handed", Notification.ticket_id.in_(TICKETS)
            )
        )
        await db.execute(
            update(Ticket).where(Ticket.id.in_(TICKETS), Ticket.routing_override.is_(True))
            .values(routing_override=False)
        )
        await db.commit()


# ── the world and the cast ───────────────────────────────────────────────────

_W: seed_task05.World | None = None
BLOCK = phone_block("t18-integration")


def world() -> seed_task05.World:
    global _W
    if _W is None:

        async def _b():
            async with AsyncSessionLocal() as db:
                return await seed_task05.build(db)

        _W = asyncio.run(_b())
    return _W


def run(coro):
    return asyncio.run(coro)


@dataclasses.dataclass
class Cast:
    a_id: uuid.UUID | None = None   # T18A - external, has an admin (Asha)
    d_id: uuid.UUID | None = None   # T18D - external, inactive
    z_id: uuid.UUID | None = None   # T18Z - external, active, no technicians
    q_id: uuid.UUID | None = None   # T18Q - external, gets a free code in the carve-out test
    a_codes: list[str] = dataclasses.field(default_factory=list)
    s_codes: list[str] = dataclasses.field(default_factory=list)
    h_codes: list[str] = dataclasses.field(default_factory=list)
    names: dict = dataclasses.field(default_factory=dict)


C = Cast()
F: dict = {}   # facts handed from one test to the next

EMAILS = {"asha": synthetic_email("t18-asha")}


def _phone(n: int) -> str:
    return synthetic_phone(BLOCK + n)


async def p(db, key: str) -> Principal:
    w = world()
    cid = w.company_a_id
    if key == "admin":
        return await seed_task05._principal_for(
            db, await seed_task05._user_by_email(db, w.company_a_admin_email), cid
        )
    mapping = {
        "priya": w.priya_email,   # S's franchisee admin
        "uma": w.uma_email,       # T's franchisee admin
        "kiran": w.kiran_email,   # Area Manager over S's state
        "nisha": w.nisha_email,   # National Head
        "asha": EMAILS["asha"],   # A's franchisee admin
    }
    if key in mapping:
        return await seed_task05.principal_by_email(db, mapping[key], cid)
    if key == "vendor":
        user = await seed_task05._user_by_email(db, w.vendor_email)
        return Principal(
            user=user, role=user.role, rank=0, is_superadmin=False,
            company_id=cid, vendor_id=w.vendor_id,
        )
    if key == "bala":  # company B's home franchisee admin (a different tenant)
        return await seed_task05.principal_by_email(db, w.bala_email, w.company_b_id)
    raise KeyError(key)


async def prof(db, tid: uuid.UUID) -> TechnicianProfile:
    return await db.get(TechnicianProfile, tid, populate_existing=True)


async def _free_codes(db, *, state_id, n: int) -> list[str]:
    """`n` active pincodes of ONE state that no franchisee owns, no technician of the company covers and no
    ticket of the company mentions - so giving them to a franchisee carves out nobody and re-stamps
    nothing it should not."""
    w = world()
    cid = w.company_a_id
    claimed = select(FranchiseePincode.pincode).where(FranchiseePincode.company_id == cid)
    covered = select(TechnicianPincode.pincode).where(TechnicianPincode.company_id == cid)
    ticketed = select(Ticket.pincode).where(Ticket.company_id == cid)
    taken = set(w.s_pincodes) | set(w.hema_pincodes)
    rows = (
        await db.execute(
            select(Pincode.code)
            .where(
                Pincode.is_active.is_(True),
                Pincode.state_id == state_id,
                Pincode.code.not_in(claimed),
                Pincode.code.not_in(covered),
                Pincode.code.not_in(ticketed),
            )
            .order_by(Pincode.code.desc())   # from the top, away from the codes other suites picked
        )
    ).all()
    codes = [c for (c,) in rows if c not in taken]
    assert len(codes) >= n, "not enough free pincodes to build the T18 cast"
    return codes[:n]


async def _ensure_franchisee(db, code: str, name: str, *, admin_email=None, admin_name=None, admin_phone=None):
    w = world()
    row = await seed_task05._franchisee_by_code(db, w.company_a_id, code)
    if row is None:
        admin = (
            FranchiseeAdminIn(fullName=admin_name, email=admin_email, phone=admin_phone)
            if admin_email else None
        )
        out = await franchisees_service.create_franchisee(
            db, await p(db, "admin"),
            FranchiseeCreateRequest(
                name=name, code=code, kind="external",
                contactName="T18 Contact", contactPhone=_phone(900 + len(code)),
                admin=admin,
            ),
        )
        return out.id
    return row.id


async def _names(db) -> dict:
    w = world()
    rows = await db.execute(select(Franchisee.id, Franchisee.name).where(Franchisee.company_id == w.company_a_id))
    return dict(rows.all())


# ── tickets, accept, close (the Task 12/17 helpers) ──────────────────────────


async def ensure_vendor_headroom(db) -> None:
    w = world()
    line = await vendor_standing(db, w.company_a_id, w.vendor_id)
    needed = line.used_paise + line.reserved_paise + 5_000_000
    if line.limit_paise < needed:
        from app.features.vendors import service as vendors_service
        from app.features.vendors.schemas import VendorUpdateRequest

        await vendors_service.update_vendor(
            db, await p(db, "admin"), w.vendor_id, VendorUpdateRequest(creditLimitPaise=needed)
        )


async def raise_ticket(db, pincode: str, *, index: int, confirm: bool = True) -> Ticket:
    """A ticket at `pincode`. `confirm=True` books the LAST offered window (far enough out that a
    cancellation is not 'under four hours' and escalates nothing); False leaves it `Slot Pending`."""
    w = world()
    await ensure_vendor_headroom(db)
    body = TicketCreateRequest(
        subcategoryId=w.leaf_id,
        modelId=w.model_id,
        serviceType=w.service_types[0],
        serialNumber=f"T18{index:04d}{uuid.uuid4().hex[:6].upper()}",
        customerName="Task18 Customer",
        customerPhone=_phone(10_000 + random.randint(0, 80_000)),
        address=f"Flat {index}, Hand Over Street",
        city="Hyderabad",
        state="Telangana",
        pincode=pincode,
        expectedDate=datetime.datetime.now(datetime.timezone.utc).date() + datetime.timedelta(days=1),
        serviceLevelHours=48,
    )
    created = await tickets_service.create_ticket(db, await p(db, "vendor"), body)
    row = await db.get(Ticket, created.id)
    TICKETS.append(row.id)
    if confirm:
        from app.core.slots import bookable_slots

        windows = await bookable_slots(db, row)
        assert windows
        await tickets_service.confirm_slot(db, row.slot_token, windows[-1][0])
    await db.refresh(row)
    return row


async def accept(db, tech_profile, row: Ticket) -> Ticket:
    await jobs_service.accept(
        db, row.id, company_id=world().company_a_id, profile=tech_profile, background=BackgroundTasks(),
    )
    await db.refresh(row)
    return row


async def customer_close(db, row: Ticket) -> Ticket:
    w = world()
    tech = await db.get(TechnicianProfile, row.technician_id, populate_existing=True)
    await jobs_service.submit_proof(
        db, row.id, company_id=w.company_a_id, profile=tech,
        artifacts=seed_artifacts(w.company_a_id, row),
        observed_serial=row.serial_number, observed_serial_source="scanned",
    )
    await db.refresh(row)
    await jobs_service.complete(db, row.id, company_id=w.company_a_id, profile=tech)
    await db.refresh(row)
    assert row.feedback_token
    await feedback_service.record_feedback(
        db, row.feedback_token, confirmed=True, rating=5, comment="Task 18 acceptance."
    )
    await db.refresh(row)
    return row


async def new_tech(db, owner: str, codes: list[str]):
    """A fresh technician at `owner` ('S' Priya's door, 'A' Asha's, 'H' staff's)."""
    w = world()
    tag = uuid.uuid4().hex[:6]
    name = f"T18 Tech {tag}"
    actor = {"S": "priya", "A": "asha", "H": "admin"}[owner]
    for _ in range(6):
        try:
            body = dict(
                fullName=name, phone=_phone(20_000 + random.randint(0, 70_000)),
                subcategoryIds=[w.leaf_id], pincodes=codes, technicianType="freelancer",
            )
            if owner == "H":
                body["regionId"] = w.region_id
            created = await tech_service.create_technician(
                db, await p(db, actor), TechnicianCreateRequest(**body)
            )
            TECHS.append(created.id)
            return created.id
        except HTTPException as exc:  # a phone collision with an earlier run
            if exc.status_code != 409:
                raise
    raise AssertionError("could not find a free phone for a T18 technician")


async def pool_ids(db, tid: uuid.UUID) -> set:
    offers, _ = await jobs_service.list_pool(
        db, ListParams(page=1, limit=300), company_id=world().company_a_id, technician_id=tid
    )
    return {o.id for o in offers}


async def reload(db, ticket_id: uuid.UUID) -> Ticket:
    return await db.get(Ticket, ticket_id, populate_existing=True)


async def events(db, ticket_id: uuid.UUID, kind: str | None = None) -> list[TicketEvent]:
    q = select(TicketEvent).where(TicketEvent.ticket_id == ticket_id).order_by(TicketEvent.seq)
    if kind:
        q = q.where(TicketEvent.kind == kind)
    return list(await db.scalars(q))


async def hand(db, who: str, ticket_id: uuid.UUID, to: uuid.UUID, reason: str = "SkyFix has no AC-certified technician"):
    return await tickets_service.hand_to_franchisee(
        db, await p(db, who), ticket_id, franchisee_id=to, reason=reason
    )


# ═══ #0 the cast ═════════════════════════════════════════════════════════════


def test_00_the_cast():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            C.s_codes, C.h_codes = list(w.s_pincodes), list(w.hema_pincodes)
            C.a_id = await _ensure_franchisee(
                db, "T18A", "T18 Acme Alpha", admin_email=EMAILS["asha"],
                admin_name="Asha Rao", admin_phone=_phone(901),
            )
            C.d_id = await _ensure_franchisee(db, "T18D", "T18 Dormant")
            C.z_id = await _ensure_franchisee(db, "T18Z", "T18 Zeta")
            C.q_id = await _ensure_franchisee(db, "T18Q", "T18 Quill")
            await db.commit()

            stored = await seed_task05._stored_codes(db, C.a_id)
            if not stored:
                codes = await _free_codes(db, state_id=w.state_id, n=3)
                await franchisees_service.set_pincodes(
                    db, await p(db, "admin"), C.a_id,
                    PincodesRequest(pincodeRanges=",".join(codes)), dry_run=False,
                )
                stored = await seed_task05._stored_codes(db, C.a_id)
            C.a_codes = stored
            assert len(C.a_codes) >= 2

            d = await db.get(Franchisee, C.d_id)
            if d.is_active:
                await franchisees_service.deactivate(db, await p(db, "admin"), C.d_id)
            z = await db.get(Franchisee, C.z_id, populate_existing=True)
            if not z.is_active:
                await franchisees_service.activate(db, await p(db, "admin"), C.z_id)
            q = await db.get(Franchisee, C.q_id, populate_existing=True)
            if not q.is_active:
                await franchisees_service.activate(db, await p(db, "admin"), C.q_id)
            await db.commit()
            C.names = await _names(db)

            F["P"] = C.s_codes[0]
            F["r"] = await new_tech(db, "S", [C.s_codes[0]])       # S's technician, covers P
            F["x"] = await new_tech(db, "A", [C.a_codes[0]])       # A's, covers only A's code
            F["xn"] = await new_tech(db, "A", [C.a_codes[1]])      # A's, will be uncertified
            F["hh"] = await new_tech(db, "H", [C.h_codes[0]])      # home's
            await db.execute(delete(TechnicianNode).where(TechnicianNode.technician_id == F["xn"]))
            await db.commit()

            for key in ("r", "x", "xn", "hh"):
                pr = await prof(db, F[key])
                assert pr.accepting_work is True and pr.status == "active", key
            assert (await franchisee_for_pincode(db, w.company_a_id, F["P"])) == w.s_id
            assert (await prof(db, F["x"])).franchisee_id == C.a_id
            assert (await prof(db, F["hh"])).franchisee_id == w.home_id
    run(_t())


# ═══ #1 the options ══════════════════════════════════════════════════════════


async def _cross_check_counts(db, tk: Ticket, owner: uuid.UUID) -> dict:
    """The doc's SQL cross-check, per franchisee: active + certified (+ covers P for the owner) + room."""
    out = {}
    for fid in (await _names(db)):
        cover = (
            "AND EXISTS (SELECT 1 FROM technician_pincodes pc WHERE pc.technician_id = tp.id AND pc.pincode = :pin)"
            if fid == owner else ""
        )
        sql = f"""SELECT count(*), count(*) FILTER (WHERE tp.accepting_work) FROM technician_profiles tp
                  WHERE tp.company_id = :c AND tp.franchisee_id = :f AND tp.status = 'active'
                    AND EXISTS (SELECT 1 FROM technician_nodes n WHERE n.technician_id = tp.id
                                AND n.node_id = ANY(:path)) {cover}"""
        row = (await db.execute(text(sql), {"c": tk.company_id, "f": fid, "pin": tk.pincode, "path": list(tk.node_path_ids)})).one()
        out[fid] = (row[0], row[1])
    return out


def test_01_options_counts_and_order():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            k = await raise_ticket(db, F["P"], index=1)
            assert (k.franchisee_id, k.routing_override, k.status) == (w.s_id, False, "New")
            F["k"] = k.id
            out = await tickets_service.franchisee_options(db, await p(db, "kiran"), k.id)
            assert out.canHandOver is True and out.blocker is None and out.slotOffered is True
            assert out.currentFranchiseeId == w.s_id and out.pincodeOwnerId == w.s_id
            assert out.routingOverride is False and out.code == k.code and out.pincode == F["P"]
            by_id = {o.id: o for o in out.options}
            assert by_id[w.s_id].isCurrent and by_id[w.s_id].ownsPincode
            assert not by_id[C.a_id].isCurrent and not by_id[C.a_id].ownsPincode
            assert C.d_id not in by_id, "an inactive franchisee is not offered"
            assert C.z_id in by_id and by_id[C.z_id].eligibleTechnicians == 0
            # A lists the certified technicians although none covers anything near P
            assert by_id[C.a_id].eligibleTechnicians >= 1
            assert by_id[w.home_id].eligibleTechnicians >= 1
            assert by_id[C.a_id].onlineTechnicians <= by_id[C.a_id].eligibleTechnicians
            # ...against the doc's SQL cross-check, franchisee by franchisee
            expected = await _cross_check_counts(db, k, owner=w.s_id)
            for fid, o in by_id.items():
                assert (o.eligibleTechnicians, o.onlineTechnicians) == expected[fid], C.names.get(fid)
            # Xn (uncertified) is in nobody's count
            assert F["xn"] not in set(await db.scalars(select(TechnicianNode.technician_id)))
            # the order: eligible desc, online desc, name
            keys = [(-o.eligibleTechnicians, -o.onlineTechnicians, o.name.lower()) for o in out.options]
            assert keys == sorted(keys)
            # "online[F] == len(technicians_covering(F, override=(F != owner)))"
            for fid, o in by_id.items():
                if fid == C.z_id:
                    continue
                cov = await technicians_covering(
                    db, company_id=k.company_id, franchisee_id=fid, routing_override=fid != w.s_id,
                    pincode=k.pincode, node_path_ids=k.node_path_ids, slot_start=k.slot_start,
                )
                assert o.onlineTechnicians == len(cov), C.names.get(fid)
            # the picker numbers via the helper agree
            counts = await technicians_by_franchisee(
                db, company_id=k.company_id, pincode=k.pincode, pincode_owner_id=w.s_id,
                node_path_ids=k.node_path_ids, slot_start=k.slot_start,
            )
            assert counts.get(C.a_id, (0, 0)) == (by_id[C.a_id].eligibleTechnicians, by_id[C.a_id].onlineTechnicians)
    run(_t())


# ═══ #2 hand over + #17 the bell ═════════════════════════════════════════════


def test_02_hand_over_writes_stamp_flag_event_and_one_bell():
    w = world()

    async def _t():
        reason = "SkyFix has no AC-certified technician"
        async with AsyncSessionLocal() as db:
            before = await reload(db, F["k"])
            F["k_prices"] = (before.technician_payout_paise, before.vendor_price_paise, dict(before.rules_snapshot or {}))
            out = await hand(db, "kiran", F["k"], C.a_id, reason)
            assert out.ticket.franchiseeId == C.a_id and out.ticket.routingOverride is True
            assert out.backInPool is False and out.ticket.status == "New"
            kiran = await p(db, "kiran")

        async with AsyncSessionLocal() as db:
            row = await reload(db, F["k"])
            assert (row.franchisee_id, row.routing_override, row.status, row.technician_id) == (C.a_id, True, "New", None)
            ev = (await events(db, F["k"], "franchisee_changed"))
            assert len(ev) == 1
            assert (ev[0].actor_kind, ev[0].actor_label) == ("staff", kiran.user.full_name)
            assert ev[0].note == f"{C.names[w.s_id]} → {C.names[C.a_id]} · handed over: {reason}"
            assert ev[0].from_status is None and ev[0].to_status is None   # status unchanged
            # notified = the audience size, counted with the push's own predicate
            cov = await technicians_covering(
                db, company_id=row.company_id, franchisee_id=C.a_id, routing_override=True,
                pincode=row.pincode, node_path_ids=row.node_path_ids, slot_start=row.slot_start,
            )
            assert out.notified == len(cov) and F["x"] in cov and F["xn"] not in cov
            # prices and the rules snapshot are the intake's, untouched (H6)
            assert (row.technician_payout_paise, row.vendor_price_paise, dict(row.rules_snapshot or {})) == F["k_prices"]

            # #17 the bell: one row for A's admin; S's admin and the manager hear nothing
            rows = list(await db.scalars(
                select(Notification).where(Notification.kind == "ticket_handed", Notification.ticket_id == F["k"])
            ))
            assert len(rows) == 1
            assert rows[0].audience == "franchisee_admin" and rows[0].franchisee_id == C.a_id
            assert rows[0].pincode is None and rows[0].to == f"/tickets/{F['k']}"
            asha, _ = await notif_service.list_page(db, await p(db, "asha"), page=1, limit=100, kind="ticket_handed")
            assert any(row.code in n.title for n in asha)
            priya, _ = await notif_service.list_page(db, await p(db, "priya"), page=1, limit=100, kind="ticket_handed")
            assert not any(row.code in n.title for n in priya)
            kir, _ = await notif_service.list_page(db, await p(db, "kiran"), page=1, limit=100, kind="ticket_handed")
            assert not any(row.code in n.title for n in kir)
            nis, _ = await notif_service.list_page(db, await p(db, "nisha"), page=1, limit=100, kind="ticket_handed")
            assert not any(row.code in n.title for n in nis)
    run(_t())


# ═══ #3 pool (1), #4 accept (3) ══════════════════════════════════════════════


def test_03_pool_waives_coverage_for_the_receiving_franchisee_only():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # control: X covers nothing near P
            n = await db.scalar(
                select(func.count()).select_from(TechnicianPincode).where(
                    TechnicianPincode.technician_id == F["x"], TechnicianPincode.pincode == F["P"])
            )
            assert n == 0
            assert F["k"] in await pool_ids(db, F["x"])
            offer = await jobs_service.get_offer(db, F["k"], company_id=w.company_a_id, technician_id=F["x"])
            assert offer.id == F["k"]
            # certification is not waived
            assert F["k"] not in await pool_ids(db, F["xn"])
            # the old franchisee's technician, and the home's: gone
            assert F["k"] not in await pool_ids(db, F["r"])
            assert F["k"] not in await pool_ids(db, F["hh"])
            for tid in (F["r"], F["hh"]):
                with pytest.raises(HTTPException) as exc:
                    await jobs_service.get_offer(db, F["k"], company_id=w.company_a_id, technician_id=tid)
                assert exc.value.status_code == 404
    run(_t())


def test_04_accept_wins_for_the_receiver_and_the_flag_survives():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            with pytest.raises(HTTPException) as exc:
                await jobs_service.accept(
                    db, F["k"], company_id=w.company_a_id, profile=await prof(db, F["r"]),
                    background=BackgroundTasks(),
                )
            assert exc.value.status_code == 404
            row = await reload(db, F["k"])
            assert row.technician_id is None
            row = await accept(db, await prof(db, F["x"]), row)
            assert (row.technician_id, row.status, row.franchisee_id, row.routing_override) == (
                F["x"], "Assigned", C.a_id, True)
    run(_t())


# ═══ #5 covering (2) and #6 the socket (5) ═══════════════════════════════════


def test_05_technicians_covering_needs_the_flag_not_the_franchisee():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            k2 = await raise_ticket(db, F["P"], index=2)
            F["k2"] = k2.id
            await hand(db, "nisha", k2.id, C.a_id)
            row = await reload(db, k2.id)
            kw = dict(company_id=row.company_id, pincode=row.pincode, node_path_ids=row.node_path_ids,
                      slot_start=row.slot_start)
            a_on = await technicians_covering(db, franchisee_id=C.a_id, routing_override=True, **kw)
            a_off = await technicians_covering(db, franchisee_id=C.a_id, routing_override=False, **kw)
            s_on = await technicians_covering(db, franchisee_id=w.s_id, routing_override=True, **kw)
            assert F["x"] in a_on
            assert F["x"] not in a_off          # the control: the flag, not the franchisee, did it
            assert F["x"] not in s_on and F["r"] in s_on   # the franchisee wall holds under the waiver
            assert F["xn"] not in a_on          # certification is not waived
            # required keyword: forgetting it fails loudly
            with pytest.raises(TypeError):
                await technicians_covering(db, franchisee_id=C.a_id, **kw)  # type: ignore[call-arg]
            sig = inspect.signature(technicians_covering)
            assert sig.parameters["routing_override"].default is inspect.Parameter.empty
    run(_t())


def test_06_pool_socket_and_the_two_frames_a_hand_over_publishes():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            k = await reload(db, F["k2"])
            path = tuple(k.node_path_ids)

            async def cov(tid):
                c = _Coverage()
                await c.load(db, company_id=w.company_a_id, technician_id=tid)
                return c

            cx, cr = await cov(F["x"]), await cov(F["r"])

            def frame(franchisee, override):
                return PoolChanged(company_id=w.company_a_id, pincode=F["P"], node_path_ids=path,
                                   franchisee_id=franchisee, routing_override=override)

            assert cx.matches(frame(C.a_id, True))
            assert not cx.matches(frame(C.a_id, False))      # the control
            assert not cx.matches(frame(w.s_id, True))       # the waiver never crosses the wall
            assert cr.matches(frame(w.s_id, False))          # the OLD franchisee's frame: its card disappears
            assert not cr.matches(frame(C.a_id, True))

            # ...and those are exactly the two frames the service publishes
            k3 = await raise_ticket(db, F["P"], index=3)
            F["k3"] = k3.id
            seen: list[dict] = []
            real = tickets_service.publish_pool_changed

            async def spy(db_, **kw):
                seen.append(kw)
                return await real(db_, **kw)

            tickets_service.publish_pool_changed = spy
            try:
                await hand(db, "nisha", k3.id, C.a_id)
            finally:
                tickets_service.publish_pool_changed = real
            assert [(f["franchisee_id"], f["routing_override"]) for f in seen] == [
                (w.s_id, False), (C.a_id, True)]
            # R's pool no longer lists it; X's does
            assert F["k3"] not in await pool_ids(db, F["r"])
            assert F["k3"] in await pool_ids(db, F["x"])
    run(_t())


# ═══ #7 release stays put ════════════════════════════════════════════════════


def test_07_release_and_restamp_leave_a_handed_ticket_where_it_is():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tx = await prof(db, F["x"])
            row = await reload(db, F["k"])
            assert row.technician_id == F["x"] and row.routing_override is True
            await jobs_service.cancel(
                db, F["k"], company_id=w.company_a_id, profile=tx, reason="Vehicle breakdown on the way"
            )
            row = await reload(db, F["k"])
            assert row.technician_id is None
            assert (row.franchisee_id, row.routing_override) == (C.a_id, True)
            assert len(await events(db, F["k"], "franchisee_changed")) == 1      # nothing written by the release
            assert not [e for e in await events(db, F["k"]) if e.actor_label == "Pincode routing"]
            if row.status in ("New", "Slot Pending"):
                assert F["k"] in await pool_ids(db, F["x"])
                assert F["k"] not in await pool_ids(db, F["r"])

            # restamp_ticket itself: None for a handed ticket, flag cleared with release_override
            assert await restamp_ticket(db, row, actor_kind="system", actor_label="Pincode routing") is None
            assert (row.franchisee_id, row.routing_override) == (C.a_id, True)
            assert len(await events(db, F["k"], "franchisee_changed")) == 1
            await db.rollback()
    run(_t())


# ═══ #8 a carve-out does not undo it ═════════════════════════════════════════


def test_08_carve_out_skips_handed_tickets_in_preview_and_apply():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            zc = (await _free_codes(db, state_id=w.state_id, n=1))[0]
            z1 = await raise_ticket(db, zc, index=11)       # ordinary, stamped home
            z2 = await raise_ticket(db, zc, index=12)       # to be handed to S
            assert z1.franchisee_id == w.home_id and z2.franchisee_id == w.home_id
            out = await hand(db, "nisha", z2.id, w.s_id, "Home has nobody for this one")
            assert out.ticket.franchiseeId == w.s_id and out.ticket.routingOverride is True
            F["z1"], F["z2"], F["zc"] = z1.id, z2.id, zc
            z1_code, z2_code = z1.code, z2.code        # the dry run rolls back and expires every instance

            admin = await p(db, "admin")
            body = PincodesRequest(pincodeRanges=zc)
            preview = await franchisees_service.set_pincodes(db, admin, C.q_id, body, dry_run=True)
            sample = {t.code for t in preview.restampedTickets.sample}
            assert z1_code in sample and z2_code not in sample
            assert preview.restampedTickets.count == len(sample)

            # a dry run rolls back and expires every instance - principals included
            await franchisees_service.set_pincodes(db, await p(db, "admin"), C.q_id, body, dry_run=False)
            a, b = await reload(db, F["z1"]), await reload(db, F["z2"])
            assert a.franchisee_id == C.q_id and a.routing_override is False       # the ordinary one moved
            assert (b.franchisee_id, b.routing_override) == (w.s_id, True)          # the handed one did not
            assert len(await events(db, F["z2"], "franchisee_changed")) == 1

            # give the code back to home; the handed ticket is still untouched
            await franchisees_service.set_pincodes(
                db, await p(db, "admin"), C.q_id, PincodesRequest(pincodeRanges=""), dry_run=False)
            a, b = await reload(db, F["z1"]), await reload(db, F["z2"])
            assert a.franchisee_id == w.home_id
            assert (b.franchisee_id, b.routing_override) == (w.s_id, True)
            assert len(await events(db, F["z2"], "franchisee_changed")) == 1
    run(_t())


# ═══ #9 assign (4) and #10 the shortlist ═════════════════════════════════════


def test_09_assign_waives_coverage_but_nothing_else():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            kiran = await p(db, "kiran")
            k2 = await reload(db, F["k2"])
            assert k2.routing_override is True and k2.technician_id is None
            # S's technician: the franchisee wall
            with pytest.raises(AppError) as exc:
                await tickets_service.assign_technician(db, kiran, F["k2"], technician_id=F["r"])
            assert (exc.value.status_code, exc.value.code) == (409, "TECHNICIAN_INELIGIBLE")
            assert "works for another franchisee" in exc.value.detail
            assert C.names[C.a_id] in exc.value.detail
            # A's uncertified technician: certification is never waived
            with pytest.raises(AppError) as exc:
                await tickets_service.assign_technician(db, kiran, F["k2"], technician_id=F["xn"])
            assert (exc.value.status_code, exc.value.code) == (409, "TECHNICIAN_INELIGIBLE")
            assert "not certified" in exc.value.detail
            # A's certified technician, covering nothing near P: allowed
            detail = await tickets_service.assign_technician(db, kiran, F["k2"], technician_id=F["x"])
            assert detail.status == "Assigned" and detail.technicianId == F["x"]
            row = await reload(db, F["k2"])
            assert (row.franchisee_id, row.routing_override) == (C.a_id, True)   # assigning never re-routes it back

            # the control: an ordinary S ticket cannot be given to X
            plain = await raise_ticket(db, F["P"], index=4)
            with pytest.raises(AppError) as exc:
                await tickets_service.assign_technician(db, kiran, plain.id, technician_id=F["x"])
            assert exc.value.code == "TECHNICIAN_INELIGIBLE"
    run(_t())


def test_10_shortlist_without_a_pincode_lists_the_receivers_technicians():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            kiran = await p(db, "kiran")
            common = dict(subcategory_id=w.leaf_id, franchisee_id=C.a_id, on_day=datetime.datetime.now(datetime.timezone.utc))
            rows, _ = await tech_service.list_technicians(db, kiran, ListParams(page=1, limit=100), **common)
            assert F["x"] in {r.id for r in rows}
            rows, _ = await tech_service.list_technicians(
                db, kiran, ListParams(page=1, limit=100), pincode=F["P"], **common)
            assert F["x"] not in {r.id for r in rows}
    run(_t())


# ═══ #11 hand back ═══════════════════════════════════════════════════════════


def test_11_hand_back_clears_the_flag_and_a_repeat_is_the_same_franchisee():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            k5 = await raise_ticket(db, F["P"], index=5)
            F["k5"] = k5.id
            await hand(db, "nisha", k5.id, C.a_id)
            assert F["k5"] not in await pool_ids(db, F["r"])
            out = await hand(db, "nisha", k5.id, w.s_id, "SkyFix hired an AC technician")
            assert out.ticket.franchiseeId == w.s_id and out.ticket.routingOverride is False
            row = await reload(db, k5.id)
            assert (row.franchisee_id, row.routing_override) == (w.s_id, False)
            assert F["k5"] in await pool_ids(db, F["r"])
            assert F["k5"] not in await pool_ids(db, F["x"])
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", k5.id, w.s_id, "again")
            assert (exc.value.status_code, exc.value.code) == (409, "SAME_FRANCHISEE")
            assert C.names[w.s_id] in exc.value.detail
            assert len(await events(db, k5.id, "franchisee_changed")) == 2
    run(_t())


# ═══ #18 money follows the technician ════════════════════════════════════════


def test_12_money_follows_the_technician_not_the_ticket():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            k6 = await raise_ticket(db, F["P"], index=6)
            F["k6"] = k6.id
            before = (k6.technician_payout_paise, k6.vendor_price_paise)
            await hand(db, "nisha", k6.id, C.a_id)
            row = await reload(db, k6.id)
            row = await accept(db, await prof(db, F["x"]), row)
            row = await customer_close(db, row)
            assert row.status == "Closed"
            assert (row.technician_payout_paise, row.vendor_price_paise) == before
            rows = list(await db.scalars(select(LedgerEntry).where(LedgerEntry.ticket_id == k6.id)))
            assert rows and {r.franchisee_id for r in rows} == {C.a_id}
            assert any(r.kind == "payout" and r.amount_paise == before[0] for r in rows) or before[0] in (None, 0)
            assert not [r for r in rows if r.franchisee_id == w.s_id]
            F["closed"] = k6.id
    run(_t())


# ═══ #12 refusals, #16 the portals and the guards ════════════════════════════


def test_13_refusals_in_the_pinned_order():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # (a) assigned to a technician (k2 was assigned to X in test 09)
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", F["k2"], C.z_id)
            assert (exc.value.status_code, exc.value.code) == (409, "TICKET_ASSIGNED")
            assert "already has a technician" in exc.value.detail
            # (b) Escalated WITH a technician (a customer's refusal)
            await db.execute(update(Ticket).where(Ticket.id == F["k2"]).values(status="Escalated"))
            await db.commit()
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", F["k2"], C.z_id)
            assert exc.value.code == "TICKET_ASSIGNED"
            await db.execute(update(Ticket).where(Ticket.id == F["k2"]).values(status="Assigned"))
            await db.commit()
            # (c) a Closed ticket
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", F["closed"], C.z_id)
            assert (exc.value.status_code, exc.value.code) == (409, "TICKET_NOT_ASSIGNABLE")
            assert "Closed" in exc.value.detail
            # ...and the options call says so with no choices to make
            out = await tickets_service.franchisee_options(db, await p(db, "nisha"), F["closed"])
            assert (out.canHandOver, out.blocker, out.options) == (False, "TICKET_NOT_ASSIGNABLE", [])
            out = await tickets_service.franchisee_options(db, await p(db, "nisha"), F["k2"])
            assert (out.canHandOver, out.blocker, out.options) == (False, "TICKET_ASSIGNED", [])
            # (d) same franchisee: the current stamp
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", F["k5"], w.s_id)
            assert exc.value.code == "SAME_FRANCHISEE"
            # (e) an inactive target
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", F["k5"], C.d_id)
            assert (exc.value.status_code, exc.value.code) == (409, "FRANCHISEE_INACTIVE")
            assert C.names[C.d_id] in exc.value.detail
            # precedence: terminal beats inactive
            with pytest.raises(AppError) as exc:
                await hand(db, "nisha", F["closed"], C.d_id)
            assert exc.value.code == "TICKET_NOT_ASSIGNABLE"
            # (f) another company's ids are a 404, never a 403
            with pytest.raises(HTTPException) as exc:
                await hand(db, "nisha", F["k5"], w.home_b_id)
            assert exc.value.status_code == 404 and exc.value.detail == "Franchisee not found"
            with pytest.raises(HTTPException) as exc:
                await hand(db, "nisha", F["k5"], uuid.uuid4())
            assert exc.value.status_code == 404
            with pytest.raises(HTTPException) as exc:
                await tickets_service.hand_to_franchisee(
                    db, await p(db, "bala"), F["k5"], franchisee_id=w.home_b_id, reason="not mine")
            assert exc.value.status_code == 404
            with pytest.raises(HTTPException) as exc:
                await tickets_service.franchisee_options(db, await p(db, "bala"), F["k5"])
            assert exc.value.status_code == 404
            # a deleted franchisee
            tag = uuid.uuid4().hex[:5].upper()
            gone = await franchisees_service.create_franchisee(
                db, await p(db, "admin"),
                FranchiseeCreateRequest(name=f"T18 Gone {tag}", code=f"GN{tag}", kind="external",
                                        contactName="T18", contactPhone=_phone(950 + random.randint(0, 40))),
            )
            await db.execute(update(Franchisee).where(Franchisee.id == gone.id).values(
                deleted_at=datetime.datetime.now(datetime.timezone.utc)))
            await db.commit()
            with pytest.raises(HTTPException) as exc:
                await hand(db, "nisha", F["k5"], gone.id)
            assert exc.value.status_code == 404
            # a ticket outside the manager's states is a 404 for her
            far = await db.scalar(
                select(Ticket.id).where(
                    Ticket.company_id == w.company_a_id,
                    Ticket.pincode.not_in(select(Pincode.code).where(Pincode.state_id == w.state_id)),
                    Ticket.deleted_at.is_(None),
                ).limit(1)
            )
            if far is not None:
                with pytest.raises(HTTPException) as exc:
                    await tickets_service.franchisee_options(db, await p(db, "kiran"), far)
                assert exc.value.status_code == 404
    run(_t())


async def run_guards(path: str, method: str, principal: Principal, db) -> None:
    """Call the guards of the REAL route, in order - what FastAPI runs before the handler (they live in
    `dependencies=[...]`, never a stacked alias)."""
    route = next(
        r for r in tickets_router.routes
        if getattr(r, "path", None) == path and method in getattr(r, "methods", set())
    )
    assert route.dependencies, "no guards on the route"
    for d in route.dependencies:
        fn = d.dependency
        args = (principal, db) if "db" in inspect.signature(fn).parameters else (principal,)
        result = fn(*args)
        if inspect.isawaitable(result):
            await result


def test_14_guards_and_the_portals():
    w = world()

    async def _t():
        post, get = "/tickets/{ticket_id}/franchisee", "/tickets/{ticket_id}/franchisee-options"
        async with AsyncSessionLocal() as db:
            for who in ("kiran", "nisha", "admin"):
                await run_guards(post, "POST", await p(db, who), db)
                await run_guards(get, "GET", await p(db, who), db)
            # both franchise admins, the vendor and a technician: 403 on both routes
            tech = await seed_task05.technician_principal(db, F["x"], w.company_a_id)
            for who in ("priya", "asha", "vendor"):
                for path, method in ((post, "POST"), (get, "GET")):
                    with pytest.raises(HTTPException) as exc:
                        await run_guards(path, method, await p(db, who), db)
                    assert exc.value.status_code == 403, (who, method)
            for path, method in ((post, "POST"), (get, "GET")):
                with pytest.raises(HTTPException) as exc:
                    await run_guards(path, method, tech, db)
                assert exc.value.status_code == 403

            # #16 the franchise portals: the source franchisee reads 404, the target reads it
            # (k5 was handed back; k3 is at A and unassigned)
            k3 = await reload(db, F["k3"])
            assert (k3.franchisee_id, k3.routing_override) == (C.a_id, True)
            priya, asha, vendor = await p(db, "priya"), await p(db, "asha"), await p(db, "vendor")
            with pytest.raises(HTTPException) as exc:
                await tickets_service.get_ticket(db, priya, F["k3"])
            assert exc.value.status_code == 404
            rows, total = await tickets_service.list_tickets(db, priya, ListParams(page=1, limit=100))
            assert F["k3"] not in {r.id for r in rows}
            s_total = await db.scalar(
                select(func.count()).select_from(Ticket).where(
                    Ticket.company_id == w.company_a_id, Ticket.franchisee_id == w.s_id, Ticket.deleted_at.is_(None))
            )
            assert total == s_total
            detail = await tickets_service.get_ticket(db, asha, F["k3"])
            assert detail.routingOverride is True and detail.franchiseeId == C.a_id
            assert any(e.kind == "franchisee_changed" for e in detail.timeline)
            with pytest.raises(HTTPException) as exc:
                await tickets_service.list_attachments(db, asha, F["k3"])
            assert exc.value.status_code == 404
            # the vendor sees neither the franchisee nor the flag
            vd = await tickets_service.get_ticket(db, vendor, F["k3"])
            assert vd.franchiseeId is None and vd.routingOverride is None
    run(_t())


# ═══ #13 the race ════════════════════════════════════════════════════════════


def test_15_a_hand_over_losing_the_race_writes_nothing():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            k = await raise_ticket(db, F["P"], index=7)
            F["k7"] = k.id
            real_lock = tickets_service.lock_routing

            async def accept_in_the_gap(db_, company_id, *, exclusive):
                await real_lock(db_, company_id, exclusive=exclusive)
                # R (S's technician) wins the ticket between the manager's read and the guarded UPDATE.
                # The app's pool is sized 1 (a SHARED server), so the rival gets one connection of its
                # own for these few statements.
                rival = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
                try:
                    async with async_sessionmaker(rival, expire_on_commit=False, autoflush=False)() as other:
                        await accept(other, await prof(other, F["r"]), await other.get(Ticket, F["k7"]))
                finally:
                    await rival.dispose()

            tickets_service.lock_routing = accept_in_the_gap
            try:
                with pytest.raises(AppError) as exc:
                    await hand(db, "nisha", F["k7"], C.a_id)
            finally:
                tickets_service.lock_routing = real_lock
            assert (exc.value.status_code, exc.value.code) == (409, "ALREADY_ASSIGNED")
            await db.rollback()
        async with AsyncSessionLocal() as db:
            row = await reload(db, F["k7"])
            assert (row.franchisee_id, row.routing_override, row.technician_id) == (w.s_id, False, F["r"])
            assert not await events(db, F["k7"], "franchisee_changed")
            n = await db.scalar(select(func.count()).select_from(Notification).where(
                Notification.kind == "ticket_handed", Notification.ticket_id == F["k7"]))
            assert n == 0
    run(_t())


# ═══ #14 an escalated ticket back to the pool ════════════════════════════════


def test_16_escalated_tickets_leave_the_queue_only_while_the_pool_can_offer_them():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # with a slot, still offerable -> New, status change in the same event row
            e1 = await raise_ticket(db, F["P"], index=8)
            await db.execute(update(Ticket).where(Ticket.id == e1.id).values(status="Escalated"))
            await db.commit()
            out = await hand(db, "kiran", e1.id, C.a_id)
            assert out.backInPool is True and out.ticket.status == "New"
            ev = (await events(db, e1.id, "franchisee_changed"))[-1]
            assert (ev.from_status, ev.to_status) == ("Escalated", "New")
            assert ev.note.endswith("· back in the pool")
            assert out.notified >= 1

            # no slot -> Slot Pending
            e2 = await raise_ticket(db, F["P"], index=9, confirm=False)
            assert e2.slot_start is None
            await db.execute(update(Ticket).where(Ticket.id == e2.id).values(status="Escalated"))
            await db.commit()
            out = await hand(db, "kiran", e2.id, C.a_id)
            assert out.backInPool is True and out.ticket.status == "Slot Pending"

            # the window has closed -> stays Escalated, nobody notified, still in the manager's queue
            e3 = await raise_ticket(db, F["P"], index=10)
            now = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(update(Ticket).where(Ticket.id == e3.id).values(
                status="Escalated", slot_start=now - datetime.timedelta(hours=3),
                slot_end=now - datetime.timedelta(hours=1)))
            await db.commit()
            opts = await tickets_service.franchisee_options(db, await p(db, "kiran"), e3.id)
            assert opts.canHandOver and opts.slotOffered is False
            out = await hand(db, "kiran", e3.id, C.a_id)
            assert (out.backInPool, out.notified, out.ticket.status) == (False, 0, "Escalated")
            row = await reload(db, e3.id)
            assert (row.franchisee_id, row.routing_override, row.status) == (C.a_id, True, "Escalated")
            ev = (await events(db, e3.id, "franchisee_changed"))[-1]
            assert (ev.from_status, ev.to_status) == (None, None)
    run(_t())


# ═══ #15 the grace ═══════════════════════════════════════════════════════════


def test_17_a_handed_ticket_gets_the_renotify_grace():
    w = world()

    async def _t():
        # Inside a session that is ROLLED BACK: the sweep scans the whole shared database.
        async with AsyncSessionLocal() as db:
            soon = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=50)
            handed = await raise_ticket(db, F["P"], index=13)
            control = await raise_ticket(db, F["P"], index=14)
            for t in (handed, control):
                await db.execute(update(Ticket).where(Ticket.id == t.id).values(
                    slot_start=soon, slot_end=soon + datetime.timedelta(hours=2)))
            await db.commit()
            await hand(db, "nisha", handed.id, C.a_id)
            F["grace"], F["control"] = handed.id, control.id

        async def sweep_and_read(backdate_minutes: int | None):
            async with AsyncSessionLocal() as db:
                real = ticket_sweeps.whatsapp_the_area_manager

                async def _quiet(*_a, **_k):
                    return None

                ticket_sweeps.whatsapp_the_area_manager = _quiet
                try:
                    if backdate_minutes:
                        await db.execute(
                            update(TicketEvent).where(
                                TicketEvent.ticket_id == F["grace"], TicketEvent.kind == "franchisee_changed"
                            ).values(created_at=datetime.datetime.now(datetime.timezone.utc)
                                     - datetime.timedelta(minutes=backdate_minutes))
                        )
                    await ticket_sweeps.sweep_unaccepted(db)
                    rows = dict((await db.execute(
                        select(Ticket.id, Ticket.status).where(Ticket.id.in_([F["grace"], F["control"]])))).all())
                finally:
                    ticket_sweeps.whatsapp_the_area_manager = real
                    await db.rollback()          # nothing the sweep did survives
                return rows

        within = await sweep_and_read(None)
        assert within[F["control"]] == "Escalated", "the control (no event) must escalate"
        assert within[F["grace"]] == "New", "the handed ticket is inside its grace"
        after = await sweep_and_read(24 * 60)
        assert after[F["grace"]] == "Escalated", "after the grace it escalates like any other"
        async with AsyncSessionLocal() as db:       # and the rolled-back sweep changed nothing
            rows = dict((await db.execute(
                select(Ticket.id, Ticket.status).where(Ticket.id.in_([F["grace"], F["control"]])))).all())
            assert rows[F["grace"]] == "New" and rows[F["control"]] == "New"
    run(_t())


# ═══ #19 deactivating the target ═════════════════════════════════════════════


def test_18_deactivating_the_target_hands_unassigned_tickets_back():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            z = await db.get(Franchisee, C.z_id, populate_existing=True)
            if not z.is_active:
                await franchisees_service.activate(db, await p(db, "admin"), C.z_id)
            k8 = await raise_ticket(db, F["P"], index=15)
            F["k8"] = k8.id
            await hand(db, "nisha", k8.id, C.z_id)
            assert (await reload(db, k8.id)).routing_override is True
            # a handed ticket pointing at a live franchisee is not drift
            assert await seed_verify._handed_tickets_point_at_active_franchisees(db, w.company_a_id) == []
            problems = await seed_verify._open_unassigned_tickets_route_by_pincode(db, w.company_a_id)
            assert not [pr for pr in problems if str(F["k8"]) in pr.detail]

            await franchisees_service.deactivate(db, await p(db, "admin"), C.z_id)
            row = await reload(db, F["k8"])
            assert (row.franchisee_id, row.routing_override) == (w.s_id, False)
            evs = await events(db, F["k8"], "franchisee_changed")
            assert len(evs) == 2 and evs[-1].actor_kind == "system"
            assert evs[-1].note == (
                f"{C.names[C.z_id]} was deactivated · handed ticket returned to {C.names[w.s_id]}")
            assert F["k8"] in await pool_ids(db, F["r"])

            # the verify check catches the survivor of a skipped step (a script that switched A off)
            await franchisees_service.activate(db, await p(db, "admin"), C.z_id)
            k9 = await raise_ticket(db, F["P"], index=16)
            await hand(db, "nisha", k9.id, C.z_id)
            await db.execute(update(Franchisee).where(Franchisee.id == C.z_id).values(is_active=False))
            await db.commit()
            problems = await seed_verify._handed_tickets_point_at_active_franchisees(db, w.company_a_id)
            assert [pr for pr in problems if str(k9.id) in pr.detail]
            await db.execute(update(Franchisee).where(Franchisee.id == C.z_id).values(is_active=True))
            await db.commit()
            assert await seed_verify._handed_tickets_point_at_active_franchisees(db, w.company_a_id) == []
    run(_t())


# ═══ #20 / #21 the migration, the scripts ════════════════════════════════════


def test_19_migration_shape_and_the_downgrade_refuses():
    async def _t():
        async with AsyncSessionLocal() as db:
            col = (await db.execute(text(
                "SELECT data_type, is_nullable, column_default FROM information_schema.columns "
                "WHERE table_name = 'tickets' AND column_name = 'routing_override'"))).one()
            assert tuple(col) == ("boolean", "NO", "false")
            live = await db.scalar(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_notifications_kind'"))
            import re

            assert set(re.findall(r"'([^']*)'", live)) == set(NOTIFICATION_KINDS)
            assert "ticket_handed" in live and "technician_moved" in live and "part_issued" in live
            head = await db.scalar(text("SELECT version_num FROM alembic_version"))
            assert head == "f3b9d1a6c845", head
            flagged = await db.scalar(text("SELECT count(*) FROM tickets WHERE routing_override"))
            assert flagged >= 1, "the refusal needs a flagged ticket"
            bells = await db.scalar(text("SELECT count(*) FROM notifications WHERE kind = 'ticket_handed'"))
            assert bells >= 1
    run(_t())

    # `alembic downgrade` while tickets are flagged: transactional DDL, so a refusal changes nothing.
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "e8a2c5b7d913"],
        cwd=API_DIR, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode != 0
    assert "Refusing to downgrade" in (proc.stderr + proc.stdout)

    async def _after():
        async with AsyncSessionLocal() as db:
            assert await db.scalar(text("SELECT version_num FROM alembic_version")) == "f3b9d1a6c845"
            assert await db.scalar(text(
                "SELECT count(*) FROM information_schema.columns WHERE table_name='tickets' AND column_name='routing_override'")) == 1
    run(_after())


def test_20_scripts_and_the_fk_coverage_query():
    w = world()
    assert run(audit_tenancy.audit()) == 0
    assert cleanup_db.run_check() == 0

    async def _t():
        async with AsyncSessionLocal() as db:
            uncovered = (await db.execute(text(
                """SELECT c.conname FROM pg_constraint c
                   WHERE c.contype = 'f' AND c.conrelid IN ('tickets'::regclass, 'notifications'::regclass)
                     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                       AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)"""))).all()
            assert uncovered == [], uncovered
            assert await seed_verify._handed_tickets_point_at_active_franchisees(db, w.company_a_id) == []
    run(_t())
