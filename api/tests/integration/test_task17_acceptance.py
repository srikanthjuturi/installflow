"""Task 17 §7 acceptance (API half) — moving a technician between franchisees,
driven through the SERVICE layer against RelianceDB (dev), the way
`test_task12_acceptance.py` runs: the cast seeded by `app.scripts.seed_task05`,
hand-built `Principal`s, a fresh session per segment, no HTTP. Run with:

    cd api
    .venv/Scripts/python.exe -m pytest tests/integration/test_task17_acceptance.py -v

**Nothing real leaves the process.** The `.env` carries live WhatsApp, e-mail and
push credentials, so a module fixture empties the tokens on `settings`, switches
push off, and replaces the outbound doors the flows touch with recorders: the
transfer's own `send_to_technician` (recorded, so the push text and its `data`
can be asserted), the temporary-password mail, and the customer feedback
request. Customers, logins and technicians are synthetic (`+911…`,
`@seed.example.com`).

Every technician is created FRESH by this module (through the product's own
`create_technician`, tagged `T17`), so nothing here depends on, or disturbs,
Ravi / Hema / Meena of Tasks 05-12. Four extra franchisees are find-or-created
(`T17P` with an admin, `T17N` with none, `T17D` inactive, `T17R` in ANOTHER
region); the pincodes they are given are codes nobody covers and no ticket
mentions, so no carve-out moves anyone it should not. The tests hand state to one
another through `F`, so run the file top to bottom.

**Data drift is simulated, on purpose.** With the F4/F6 invariant intact a
technician's pincodes all lie in their own franchisee's area, so "keep what is
inside the target's range" keeps nothing for any other target. The doc's worked
example (a technician covering codes two franchisees own) is legacy drift; a few
tests insert such a `technician_pincodes` row directly to exercise the
kept/trimmed arithmetic end to end.

What this file does NOT prove (no HTTP, no devices): the route wiring in a
running server (the guard FUNCTIONS of the real route are called directly), the
`message` strings of the envelope, two terminals racing over the wire (the race
is two sessions here), a phone receiving the push, and the console (§7 #23).

At the end the module deletes the `technician_transfers` rows it wrote, so the
dev database can still walk `downgrade d6c3a9f1e874` (the migration refuses while
any row exists). A run that dies mid-way leaves them; delete the rows of the
`T17` technicians by hand.
"""

import asyncio
import dataclasses
import datetime
import inspect
import random
import sys
import types
import uuid

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from sqlalchemy import delete, func, select, text, update  # noqa: E402

from app.core import franchise_logins  # noqa: E402
from app.core import technician_transfer as tt  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.coverage import technicians_covering  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import Principal  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.core.ledger import (  # noqa: E402
    cap_remaining,
    charged_this_month,
    open_redemption_exists,
    redeemable_balance,
)
from app.core.money import rupees  # noqa: E402
from app.core.schemas import ListParams  # noqa: E402
from app.core.statements import load_statement  # noqa: E402
from app.features.franchisees import service as franchisees_service  # noqa: E402
from app.features.franchisees.schemas import (  # noqa: E402
    FranchiseeAdminIn,
    FranchiseeCreateRequest,
    PincodesRequest,
)
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.notifications import service as notif_service  # noqa: E402
from app.features.redemptions import service as red_service  # noqa: E402
from app.features.redemptions.schemas import (  # noqa: E402
    ClaimRequest,
    DeclineRequest,
    ProofIn,
    RedeemRequest,
)
from app.features.technicians import service as tech_service  # noqa: E402
from app.features.technicians import transfer_service  # noqa: E402
from app.features.technicians.router import router as technicians_router  # noqa: E402
from app.features.technicians.schemas import (  # noqa: E402
    TechnicianCreateRequest,
    TechnicianTransferRequest,
    UpiChangeRequestIn,
)
from app.features.tickets import feedback_service  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import TicketCreateRequest  # noqa: E402
from app.core.vendor_credits import standing as vendor_standing  # noqa: E402
from app.models.franchisee import Franchisee, FranchiseePincode  # noqa: E402
from app.models.ledger import LedgerEntry  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.redemption import Redemption  # noqa: E402
from app.models.role import ROLE_RANKS, NATIONAL_HEAD  # noqa: E402
from app.models.technician import TechnicianPincode, TechnicianProfile  # noqa: E402
from app.models.technician_transfer import TechnicianTransfer  # noqa: E402
from app.models.territory import MembershipRegion, Pincode, State  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.upi_change import UpiChangeRequest  # noqa: E402
from app.models.user import User  # noqa: E402
from app.scripts import audit_tenancy, cleanup_db, seed_task05  # noqa: E402
from tests.integration.test_task05_acceptance import settle_open_jobs  # noqa: E402
from app.scripts.seed import verify as seed_verify  # noqa: E402
from app.scripts.seed.guards import synthetic_email, synthetic_phone  # noqa: E402
from app.scripts.seed.lifecycle import _artifacts as seed_artifacts  # noqa: E402
from app.scripts.seed.tenant import phone_block  # noqa: E402

# ── nothing real leaves the process ──────────────────────────────────────────

#: (technician id, push key, params, data) — what `send_to_technician` was asked.
PUSHES: list[tuple[uuid.UUID, str, dict, dict | None]] = []
TECHS: list[uuid.UUID] = []  # every technician this run created — for cleanup


@pytest.fixture(scope="module", autouse=True)
def _no_real_sends():
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "WHATSAPP_TOKEN", "")
    mp.setattr(settings, "PUSH_ENABLED", False)
    mp.setattr(settings, "WEB_PUSH_ENABLED", False)
    mp.setattr(settings, "ACS_CONNECTION_STRING", "")

    async def _push(db, *, company_id, technician_id, message, data=None):
        PUSHES.append((technician_id, message.key, dict(message.params), data))
        return 0

    async def _mail(**_kw):
        return types.SimpleNamespace(ok=True, error=None)

    async def _nothing(*_a, **_k):
        return None

    mp.setattr(transfer_service, "send_to_technician", _push)
    mp.setattr(franchise_logins, "send_temporary_password", _mail)
    mp.setattr(jobs_service, "_send_feedback_request", _nothing)
    yield
    try:
        # Runs on a failure too: the cast and every technician this module made.
        settle_open_jobs(TECHS)
    finally:
        mp.undo()
    # Leave the dev database able to walk the migration back down.
    async def _tidy():
        async with AsyncSessionLocal() as db:
            if TECHS:
                await db.execute(
                    delete(TechnicianTransfer).where(TechnicianTransfer.technician_id.in_(TECHS))
                )
                await db.commit()

    asyncio.run(_tidy())


# ── the world and the cast ───────────────────────────────────────────────────

_W: seed_task05.World | None = None
BLOCK = phone_block("t17-integration")


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
    """Ids of the franchisees this module owns, and the codes they were given."""

    p_id: uuid.UUID | None = None      # T17P - external, has an admin (Pavan)
    n_id: uuid.UUID | None = None      # T17N - external, NO admin
    d_id: uuid.UUID | None = None      # T17D - external, inactive
    r_id: uuid.UUID | None = None      # T17R - external, another region, has an admin
    p_codes: list[str] = dataclasses.field(default_factory=list)
    n_codes: list[str] = dataclasses.field(default_factory=list)
    r_codes: list[str] = dataclasses.field(default_factory=list)
    r_spare: str | None = None         # in R's region, owned by nobody -> home
    r_region_id: uuid.UUID | None = None
    s_codes: list[str] = dataclasses.field(default_factory=list)
    h_codes: list[str] = dataclasses.field(default_factory=list)


C = Cast()
F: dict = {}   # facts handed from one test to the next

EMAILS = {
    "pavan": synthetic_email("t17-pavan"),
    "rhea": synthetic_email("t17-rhea"),
}


def _phone(n: int) -> str:
    return synthetic_phone(BLOCK + n)


async def user_principal(db, email: str, company_id) -> Principal:
    return await seed_task05.principal_by_email(db, email, company_id)


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
        "hari": w.hari_email,     # H's franchisee admin
        "kiran": w.kiran_email,   # Area Manager over S's state
        "nisha": w.nisha_email,   # National Head
        "pavan": EMAILS["pavan"],
        "rhea": EMAILS["rhea"],
    }
    if key in mapping:
        return await user_principal(db, mapping[key], cid)
    if key == "vendor":
        user = await seed_task05._user_by_email(db, w.vendor_email)
        return Principal(
            user=user, role=user.role, rank=0, is_superadmin=False,
            company_id=cid, vendor_id=w.vendor_id,
        )
    if key == "bala":  # company B's home franchisee admin (a different tenant)
        return await user_principal(db, w.bala_email, w.company_b_id)
    raise KeyError(key)


async def tech_principal(db, tid: uuid.UUID) -> Principal:
    return await seed_task05.technician_principal(db, tid, world().company_a_id)


async def prof(db, tid: uuid.UUID) -> TechnicianProfile:
    return await db.get(TechnicianProfile, tid, populate_existing=True)


# ── cast building: franchisees on codes nobody uses ──────────────────────────


async def _free_codes(db, *, state_id=None, not_region=None, n: int) -> tuple[uuid.UUID, list[str]]:
    """`n` active pincodes of ONE state that no franchisee owns, no technician of
    the company covers and no ticket of the company mentions — so giving them to
    a franchisee carves out nobody and re-stamps nothing."""
    w = world()
    cid = w.company_a_id
    claimed = select(FranchiseePincode.pincode).where(FranchiseePincode.company_id == cid)
    covered = select(TechnicianPincode.pincode).where(TechnicianPincode.company_id == cid)
    ticketed = select(Ticket.pincode).where(Ticket.company_id == cid)
    taken = set(w.s_pincodes) | set(w.hema_pincodes)
    q = (
        select(Pincode.code, Pincode.state_id)
        .join(State, State.id == Pincode.state_id)
        .where(
            Pincode.is_active.is_(True),
            Pincode.code.not_in(claimed),
            Pincode.code.not_in(covered),
            Pincode.code.not_in(ticketed),
        )
        .order_by(Pincode.state_id, Pincode.code)
    )
    if state_id is not None:
        q = q.where(Pincode.state_id == state_id)
    if not_region is not None:
        q = q.where(State.region_id != not_region)
    by_state: dict = {}
    for code, sid in (await db.execute(q)).all():
        if code in taken:
            continue
        by_state.setdefault(sid, []).append(code)
    for sid, codes in by_state.items():
        if len(codes) >= n:
            return sid, codes[:n]
    raise AssertionError("not enough free pincodes to build the T17 cast")


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
                contactName="T17 Contact", contactPhone=_phone(900 + len(code)),
                admin=admin,
            ),
        )
        return out.id
    return row.id


async def _ensure_codes(db, franchisee_id, codes: list[str]) -> list[str]:
    stored = await seed_task05._stored_codes(db, franchisee_id)
    if stored:
        return stored
    await franchisees_service.set_pincodes(
        db, await p(db, "admin"), franchisee_id,
        PincodesRequest(pincodeRanges=",".join(codes)), dry_run=False,
    )
    return await seed_task05._stored_codes(db, franchisee_id)


def test_00_the_cast():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            C.s_codes = list(w.s_pincodes)
            C.h_codes = list(w.hema_pincodes)

            C.p_id = await _ensure_franchisee(
                db, "T17P", "T17 Partner", admin_email=EMAILS["pavan"],
                admin_name="Pavan Joshi", admin_phone=_phone(901),
            )
            C.n_id = await _ensure_franchisee(db, "T17N", "T17 No Admin")
            C.d_id = await _ensure_franchisee(db, "T17D", "T17 Dormant")
            C.r_id = await _ensure_franchisee(
                db, "T17R", "T17 Far Region", admin_email=EMAILS["rhea"],
                admin_name="Rhea Das", admin_phone=_phone(902),
            )
            await db.commit()

            # P and N in S's state, away from everything anybody uses.
            state_id = w.state_id
            if not await seed_task05._stored_codes(db, C.p_id):
                _s, codes = await _free_codes(db, state_id=state_id, n=5)
                await _ensure_codes(db, C.p_id, codes[:3])
                await _ensure_codes(db, C.n_id, codes[3:5])
            C.p_codes = await seed_task05._stored_codes(db, C.p_id)
            C.n_codes = await seed_task05._stored_codes(db, C.n_id)

            # R in ANOTHER region, plus one spare code in that region left to home.
            stored_r = await seed_task05._stored_codes(db, C.r_id)
            if not stored_r:
                _sid, codes = await _free_codes(db, not_region=w.region_id, n=4)
                stored_r = await _ensure_codes(db, C.r_id, codes[:3])
                C.r_spare = codes[3]
            else:
                _sid, codes = await _free_codes(db, not_region=w.region_id, n=1)
                C.r_spare = codes[0]
            C.r_codes = stored_r
            C.r_region_id = await db.scalar(
                select(State.region_id)
                .join(Pincode, Pincode.state_id == State.id)
                .where(Pincode.code == C.r_codes[0])
            )
            assert C.r_region_id != w.region_id

            # D goes dormant (it holds no technician and no code, so it may).
            d = await db.get(Franchisee, C.d_id)
            if d.is_active:
                await franchisees_service.deactivate(db, await p(db, "admin"), C.d_id)
            await db.commit()

            assert len(C.p_codes) >= 2 and len(C.n_codes) >= 1 and len(C.r_codes) >= 2
            assert not set(C.p_codes) & set(C.s_codes)
    run(_t())


# ── tickets, accept, close (copied from the Task 05/12 suites) ───────────────


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


async def raise_ticket(db, pincode: str, *, index: int) -> Ticket:
    w = world()
    await ensure_vendor_headroom(db)
    body = TicketCreateRequest(
        subcategoryId=w.leaf_id,
        modelId=w.model_id,
        serviceType=w.service_types[0],
        serialNumber=f"T17{index:04d}{uuid.uuid4().hex[:6].upper()}",
        customerName="Task17 Customer",
        customerPhone=_phone(10_000 + random.randint(0, 80_000)),
        address=f"Flat {index}, Move Street",
        city="Hyderabad",
        state="Telangana",
        pincode=pincode,
        expectedDate=datetime.datetime.now(datetime.timezone.utc).date()
        + datetime.timedelta(days=1),
        serviceLevelHours=48,
    )
    created = await tickets_service.create_ticket(db, await p(db, "vendor"), body)
    row = await db.get(Ticket, created.id)
    from app.core.slots import bookable_slots

    windows = await bookable_slots(db, row)
    assert windows
    await tickets_service.confirm_slot(db, row.slot_token, windows[0][0])
    await db.refresh(row)
    return row


async def accept(db, tech_profile, row: Ticket) -> Ticket:
    await jobs_service.accept(
        db, row.id, company_id=world().company_a_id, profile=tech_profile,
        background=BackgroundTasks(),
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
        db, row.feedback_token, confirmed=True, rating=5, comment="Task 17 acceptance."
    )
    await db.refresh(row)
    return row


async def cancel_job(db, tech_profile, row: Ticket) -> LedgerEntry:
    """The technician gives an accepted job back - a cancellation penalty row,
    stamped with their franchisee AT THIS MOMENT."""
    await jobs_service.cancel(
        db, row.id, company_id=world().company_a_id, profile=tech_profile,
        reason="Vehicle breakdown on the way",
    )
    entry = await db.scalar(
        select(LedgerEntry)
        .where(
            LedgerEntry.ticket_id == row.id,
            LedgerEntry.technician_id == tech_profile.id,
            LedgerEntry.kind == "penalty",
        )
        .order_by(LedgerEntry.created_at.desc())
    )
    assert entry is not None, "cancelling charged nothing"
    return entry


# ── technicians ──────────────────────────────────────────────────────────────


async def new_tech(db, owner: str, codes: list[str], *, kind: str = "freelancer", upi: bool = False):
    """A fresh technician at `owner` ('S' Priya's door, 'P' Pavan's, 'H' staff's)."""
    w = world()
    tag = uuid.uuid4().hex[:6]
    name = f"T17 Tech {tag}"
    actor = {"S": "priya", "P": "pavan", "H": "admin"}[owner]
    for _ in range(6):
        phone = _phone(20_000 + random.randint(0, 70_000))
        try:
            body = dict(
                fullName=name, phone=phone, subcategoryIds=[w.leaf_id], pincodes=codes,
                technicianType=kind,
            )
            if owner == "H":
                body["regionId"] = w.region_id
            if upi:
                body["upiId"] = f"t17{tag}@ybl"
                body["upiName"] = name
            created = await tech_service.create_technician(
                db, await p(db, actor), TechnicianCreateRequest(**body)
            )
            TECHS.append(created.id)
            return created.id, name
        except HTTPException as exc:  # a phone collision with an earlier run
            if exc.status_code != 409:
                raise
    raise AssertionError("could not find a free phone for a T17 technician")


async def drift(db, tid: uuid.UUID, code: str) -> None:
    """Simulate legacy data: coverage naming a code ANOTHER franchisee owns."""
    exists = await db.scalar(
        select(TechnicianPincode.id).where(
            TechnicianPincode.technician_id == tid, TechnicianPincode.pincode == code
        )
    )
    if exists is None:
        db.add(TechnicianPincode(technician_id=tid, company_id=world().company_a_id, pincode=code))
    await db.commit()


async def coverage_of(db, tid: uuid.UUID) -> list[str]:
    return sorted(
        await db.scalars(select(TechnicianPincode.pincode).where(TechnicianPincode.technician_id == tid))
    )


async def snapshot(db, tid: uuid.UUID) -> dict:
    """Everything §7 #2 / #5 compare before and after."""
    fid = await db.scalar(select(TechnicianProfile.franchisee_id).where(TechnicianProfile.id == tid))
    return {
        "franchisee": fid,
        "pincodes": await coverage_of(db, tid),
        "transfers": await db.scalar(
            select(func.count()).select_from(TechnicianTransfer).where(TechnicianTransfer.technician_id == tid)
        ),
        "bells": await db.scalar(
            select(func.count()).select_from(Notification).where(Notification.kind == "technician_moved")
        ),
    }


async def transfer(who: str, tid: uuid.UUID, franchisee_id, *, reason=None, pincodes=None, dry=False):
    async with AsyncSessionLocal() as db:
        return await transfer_service.transfer_technician(
            db, await p(db, who), tid,
            TechnicianTransferRequest(franchiseeId=franchisee_id, reason=reason, pincodes=pincodes),
            dry_run=dry,
        )


def codes_of(out) -> list[str | None]:
    return [b.code for b in out.blockers]


# ── #1. migration, registries, scripts ───────────────────────────────────────


def test_01_migration_shape_registries_and_scripts():
    async def _t():
        async with AsyncSessionLocal() as db:
            cons = {
                r[0]: r[1]
                for r in await db.execute(
                    text(
                        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                        "WHERE conrelid = 'technician_transfers'::regclass"
                    )
                )
            }
            for name in (
                "ck_technician_transfers_different_franchisees",
                "ck_technician_transfers_reason_length",
                "ck_technician_transfers_technician_type",
                "ck_technician_transfers_coverage_shape",
                "fk_technician_transfers_company_technician",
                "fk_technician_transfers_company_from",
                "fk_technician_transfers_company_to",
                "pk_technician_transfers",
            ):
                assert name in cons, name
            assert "ON DELETE CASCADE" in cons["fk_technician_transfers_company_technician"]
            assert "ON DELETE RESTRICT" in cons["fk_technician_transfers_company_from"]
            uncovered = (
                await db.execute(
                    text(
                        """SELECT c.conname FROM pg_constraint c
                           WHERE c.contype = 'f' AND c.conrelid = 'technician_transfers'::regclass
                             AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                               AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)"""
                    )
                )
            ).all()
            assert uncovered == [], uncovered
            head = await db.scalar(text("SELECT version_num FROM alembic_version"))
            # Task 18 (f3b9d1a6c845) chains after this revision: the shape asserted here is
            # Task 17's, so any head at or after it is fine.
            assert head in ("e8a2c5b7d913", "f3b9d1a6c845"), head
    run(_t())
    assert run(audit_tenancy.audit()) == 0
    assert cleanup_db.run_check() == 0


# ── #2 / #3 / #4 / #18. dry run, apply, what did not move, bells and push ────


def test_02_dry_run_changes_nothing():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, name = await new_tech(db, "H", C.h_codes[:2])
            await drift(db, tid, C.s_codes[0])
            await drift(db, tid, C.s_codes[1])
            F["d1"], F["d1_name"] = tid, name
            before = await snapshot(db, tid)
            assert before["franchisee"] == w.home_id
        out = await transfer("nisha", tid, w.s_id, dry=True)
        assert out.dryRun is True and out.transfer is None
        assert out.canTransfer is True and out.blockers == []
        assert out.fromFranchiseeIsHome is True and out.toFranchiseeIsHome is False
        assert out.fromFranchiseeName != out.toFranchiseeName
        assert out.coverage.source == "kept"
        assert out.coverage.kept == sorted(C.s_codes[:2])
        assert out.coverage.trimmed == sorted(C.h_codes[:2])
        assert out.coverage.added == [] and out.coverage.after == sorted(C.s_codes[:2])
        assert (out.coverage.keptCount, out.coverage.trimmedCount, out.coverage.addedCount) == (2, 2, 0)
        assert out.coverage.regionChanged is False
        # No reason was sent: a preview is allowed to run before anybody has typed.
        async with AsyncSessionLocal() as db:
            assert await snapshot(db, tid) == before
    run(_t())


def test_03_apply_writes_the_move_the_audit_two_bells_and_a_push():
    w = world()

    async def _t():
        tid = F["d1"]
        reason = "Moved east; SkyFix will run the area"
        out = await transfer("nisha", tid, w.s_id, reason=reason)
        assert out.dryRun is False and out.canTransfer is True and out.blockers == []
        row = out.transfer
        assert row is not None and row.byName == "Nisha Kulkarni"
        assert row.fromFranchiseeId == w.home_id and row.toFranchiseeId == w.s_id
        assert row.reason == reason
        assert row.kept == sorted(C.s_codes[:2]) and row.trimmed == sorted(C.h_codes[:2]) and row.added == []

        async with AsyncSessionLocal() as db:
            profile = await prof(db, tid)
            assert profile.franchisee_id == w.s_id
            assert await coverage_of(db, tid) == sorted(C.s_codes[:2])
            t = await db.scalar(select(TechnicianTransfer).where(TechnicianTransfer.technician_id == tid))
            assert (t.from_franchisee_id, t.to_franchisee_id) == (w.home_id, w.s_id)
            assert t.coverage_before == sorted([*C.h_codes[:2], *C.s_codes[:2]])
            assert t.coverage_after == sorted(C.s_codes[:2])
            assert t.reason == reason and t.technician_type == "freelancer"
            nisha = await p(db, "nisha")
            assert t.transferred_by_user_id == nisha.user_id
            assert t.transferred_by_label == "Nisha Kulkarni"

            # #18 - the two bells, written in the move's transaction.
            name = F["d1_name"]
            joining = await db.scalar(
                select(Notification).where(
                    Notification.kind == "technician_moved", Notification.title == f"{name} joined SkyFix Services"
                )
            )
            leaving = await db.scalar(
                select(Notification).where(
                    Notification.kind == "technician_moved",
                    Notification.title.like(f"{name} moved to %"),
                )
            )
            assert joining is not None and leaving is not None
            assert (joining.audience, joining.franchisee_id, joining.pincode) == ("franchisee_admin", w.s_id, None)
            assert (leaving.audience, leaving.franchisee_id, leaving.pincode) == (None, w.home_id, None)
            assert joining.to == f"/technicians/{tid}" and leaving.to == "/technicians"
            assert "from " in joining.detail and reason in joining.detail

            # who hears what (Task 05 `audience.hears`, through the real feed)
            async def titles(key):
                rows, _ = await notif_service.list_page(
                    db, await p(db, key), page=1, limit=100, kind="technician_moved"
                )
                return {n.title for n in rows}

            j_title, l_title = joining.title, leaving.title
            priya, nisha_t, kiran, hari, uma = [
                await titles(k) for k in ("priya", "nisha", "kiran", "hari", "uma")
            ]
            assert j_title in priya and l_title not in priya
            assert l_title in nisha_t and j_title not in nisha_t
            assert l_title in kiran and j_title not in kiran
            assert l_title in hari and j_title not in hari          # home's own franchisee admin
            assert j_title not in uma and l_title not in uma         # a second franchisee hears neither

        # the push: one, to the technician, `job` type with NO ticket id (D9)
        pushes = [x for x in PUSHES if x[0] == tid]
        assert len(pushes) == 1
        _tid, key, params, data = pushes[0]
        assert key == "technician.moved" and params == {"franchisee": "SkyFix Services"}
        assert data == {"type": "job"} and "ticketId" not in data
    run(_t())


# ── #5 / #6 / #4. open job, balance, redemption, then the clean move ─────────


def test_05_open_job_blocks_dry_run_and_apply_and_writes_nothing():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, name = await new_tech(db, "S", C.s_codes, kind="freelancer", upi=True)
            F["r1"], F["r1_name"] = tid, name
            row = await raise_ticket(db, C.s_codes[0], index=1)
            await accept(db, await prof(db, tid), row)
            assert row.status == "Assigned" and row.technician_id == tid
            F["r1_ticket"] = row.id
            before = await snapshot(db, tid)

        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=C.p_codes[:2])
        assert out.canTransfer is False
        blocker = out.blockers[0]
        assert blocker.code == "TECHNICIAN_HAS_OPEN_JOBS" and blocker.openJobs == 1
        assert codes_of(out) == ["TECHNICIAN_HAS_OPEN_JOBS"]

        with pytest.raises(AppError) as exc:
            await transfer("nisha", tid, C.p_id, reason="Needs a new area to work", pincodes=C.p_codes[:2])
        assert exc.value.status_code == 409 and exc.value.code == "TECHNICIAN_HAS_OPEN_JOBS"
        assert "open job" in exc.value.detail

        async with AsyncSessionLocal() as db:
            assert await snapshot(db, tid) == before     # nothing written, no bell
    run(_t())


def test_06_balance_open_redemption_declined_and_the_clean_move():
    w = world()

    async def _t():
        tid = F["r1"]
        # the job closes: a payout, stamped S
        async with AsyncSessionLocal() as db:
            row = await db.get(Ticket, F["r1_ticket"], populate_existing=True)
            await customer_close(db, row)
            assert row.status == "Closed"
            owed = await redeemable_balance(db, company_id=w.company_a_id, technician_id=tid)
            assert owed > 0
            F["r1_owed"] = owed

        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=C.p_codes[:2])
        assert codes_of(out) == ["TECHNICIAN_HAS_BALANCE"]
        assert out.blockers[0].redeemablePaise == F["r1_owed"]
        assert rupees(F["r1_owed"]) in out.blockers[0].message
        with pytest.raises(AppError) as exc:
            await transfer("nisha", tid, C.p_id, reason="Needs a new area to work", pincodes=C.p_codes[:2])
        assert (exc.value.status_code, exc.value.code) == (409, "TECHNICIAN_HAS_BALANCE")

        # redeem it: to_pay -> still blocked, now naming the redemption
        async with AsyncSessionLocal() as db:
            ravi = await prof(db, tid)
            amount = red_service.redeemable(F["r1_owed"])
            red = await red_service.request(db, await tech_principal(db, tid), ravi, RedeemRequest(amountPaise=amount))
            assert await open_redemption_exists(db, company_id=w.company_a_id, technician_id=tid)
            code = await db.scalar(select(Redemption.code).where(Redemption.id == red.id))
            F["r1_red"], F["r1_red_code"] = red.id, code
        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=C.p_codes[:2])
        assert codes_of(out) == ["TECHNICIAN_HAS_BALANCE"]
        assert out.blockers[0].redemptionCode == code and out.blockers[0].redeemablePaise is None

        # the payer DECLINES: a declined redemption does not block AS a redemption,
        # but the money is the technician's again, so the balance blocker returns.
        async with AsyncSessionLocal() as db:
            await red_service.decline(db, await p(db, "priya"), F["r1_red"], DeclineRequest(reason="Wrong account"))
        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=C.p_codes[:2])
        assert [b.redemptionCode for b in out.blockers] == [None]
        assert codes_of(out) == ["TECHNICIAN_HAS_BALANCE"] and out.blockers[0].redeemablePaise == F["r1_owed"]

        # redeem again, the payer claims ("awaiting"): still blocked
        async with AsyncSessionLocal() as db:
            ravi = await prof(db, tid)
            red = await red_service.request(db, await tech_principal(db, tid), ravi, RedeemRequest(amountPaise=amount))
            claimed = await red_service.claim(
                db, await p(db, "priya"), red.id,
                ClaimRequest(proof=ProofIn(blobName=f"attachment/{w.company_a_id}/t17/{red.id}/proof.png"),
                             utr=f"T17UTR{uuid.uuid4().hex[:10]}"),
            )
            assert claimed.state == "awaiting"
        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=C.p_codes[:2])
        assert codes_of(out) == ["TECHNICIAN_HAS_BALANCE"] and out.blockers[0].redemptionCode

        # the technician confirms it arrived -> settled -> the way is clear
        async with AsyncSessionLocal() as db:
            ravi = await prof(db, tid)
            settled = await red_service.confirm(db, await tech_principal(db, tid), ravi, red.id, received=True)
            assert settled.state == "settled"
            assert not await open_redemption_exists(db, company_id=w.company_a_id, technician_id=tid)

            # #4 - what must NOT move: hash the history and the person
            F["r1_before"] = await _history_hash(db, tid)

        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=C.p_codes[:2])
        assert out.canTransfer is True and out.blockers == []
        moved = await transfer("nisha", tid, C.p_id, reason="Needs a new area to work", pincodes=C.p_codes[:2])
        assert moved.transfer is not None

        async with AsyncSessionLocal() as db:
            assert (await prof(db, tid)).franchisee_id == C.p_id
            after = await _history_hash(db, tid)
            # tickets, ledger and redemptions are byte-identical - the franchisee
            # on every one of them is where it was EARNED (S), not where he is.
            assert after["tickets"] == F["r1_before"]["tickets"]
            assert after["ledger"] == F["r1_before"]["ledger"]
            assert after["redemptions"] == F["r1_before"]["redemptions"]
            assert after["person"] == F["r1_before"]["person"]
            others = await db.scalar(
                text(
                    """SELECT (SELECT count(*) FROM tickets WHERE technician_id = :t AND franchisee_id <> :s)
                            + (SELECT count(*) FROM ledger_entries WHERE technician_id = :t AND franchisee_id <> :s)
                            + (SELECT count(*) FROM redemptions WHERE technician_id = :t AND franchisee_id <> :s)"""
                ).bindparams(t=tid, s=w.s_id)
            )
            assert others == 0
    run(_t())


async def _history_hash(db, tid: uuid.UUID) -> dict:
    q = lambda sql: db.scalar(text(sql).bindparams(t=tid))  # noqa: E731
    return {
        "tickets": await q("SELECT md5(string_agg(id::text || franchisee_id::text, ',' ORDER BY id)) FROM tickets WHERE technician_id = :t"),
        "ledger": await q("SELECT md5(string_agg(id::text || franchisee_id::text || amount_paise::text, ',' ORDER BY id)) FROM ledger_entries WHERE technician_id = :t"),
        "redemptions": await q("SELECT md5(string_agg(id::text || franchisee_id::text, ',' ORDER BY id)) FROM redemptions WHERE technician_id = :t"),
        # D4 - the person: everything but franchisee_id, coverage and audit stamps
        "person": await q(
            """SELECT md5(row(code, technician_type, daily_job_cap, status, accepting_work, upi_id, upi_name,
                              base_latitude, base_longitude, base_pincode, base_source, appointed_by_user_id,
                              onboarding_mode, registered_by, membership_id)::text)
               FROM technician_profiles WHERE id = :t"""
        ),
    }


# ── #7 / #13 (reversal) / #15. a negative balance moves; the cap carries ─────


def test_07_negative_balance_warns_and_moves_then_the_cap_and_reversal():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, name = await new_tech(db, "H", C.h_codes[:2], kind="freelancer")
            F["r3"] = tid
            row = await raise_ticket(db, C.h_codes[0], index=2)
            await accept(db, await prof(db, tid), row)
            penalty1 = await cancel_job(db, await prof(db, tid), row)
            assert penalty1.franchisee_id == w.home_id
            F["r3_pen1"], F["r3_pen1_ticket"] = penalty1.id, row.id
            bal = await redeemable_balance(db, company_id=w.company_a_id, technician_id=tid)
            assert bal == -penalty1.amount_paise < 0

        dry = await transfer("nisha", tid, w.s_id, dry=True, pincodes=[C.s_codes[1]])
        assert dry.blockers == [] and dry.canTransfer is True
        assert any(rupees(penalty1.amount_paise) in x for x in dry.warnings), dry.warnings
        applied = await transfer("nisha", tid, w.s_id, reason="Moving to the east side", pincodes=[C.s_codes[1]])
        assert applied.transfer is not None

        # #15 the cap is the technician's, across franchisees: a second penalty,
        # now under S, and the month's total is the sum of both.
        async with AsyncSessionLocal() as db:
            row2 = await raise_ticket(db, C.s_codes[1], index=3)
            await accept(db, await prof(db, tid), row2)
            penalty2 = await cancel_job(db, await prof(db, tid), row2)
            assert penalty2.franchisee_id == w.s_id
            total = await charged_this_month(db, company_id=w.company_a_id, technician_id=tid)
            assert total == penalty1.amount_paise + penalty2.amount_paise
            rules_cap = 500_000   # rules.DEFAULTS["cancel_penalty_cap_paise"]
            assert cap_remaining(cap_paise=rules_cap, already_charged=total) == rules_cap - total

            # #13b the OLD penalty is given back by Nisha: the reversal copies the
            # PENALTY's franchisee (H), so H's pool moves and S's does not.
            await tickets_service.reverse_penalty(
                db, await p(db, "nisha"), F["r3_pen1_ticket"], F["r3_pen1"], reason="Breakdown was real"
            )
            rev = await db.scalar(select(LedgerEntry).where(LedgerEntry.reverses_id == F["r3_pen1"]))
            assert rev is not None and rev.kind == "reversal" and rev.franchisee_id == w.home_id
            after = await charged_this_month(db, company_id=w.company_a_id, technician_id=tid)
            assert after == penalty2.amount_paise
    run(_t())


# ── #8 / #9 / #10 / #11. coverage ────────────────────────────────────────────


def test_08_nothing_left_is_refused_until_pincodes_are_supplied():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "S", [C.s_codes[0]])
            before = await snapshot(db, tid)
        out = await transfer("nisha", tid, C.p_id, dry=True)
        assert out.coverage.after == [] and out.coverage.trimmed == [C.s_codes[0]]
        assert codes_of(out) == ["PINCODE_OUTSIDE_FRANCHISEE"]
        assert out.blockers[0].message.startswith("None of ")
        assert "is inside T17 Partner's area" in out.blockers[0].message
        with pytest.raises(AppError) as exc:
            await transfer("nisha", tid, C.p_id, reason="Needs a new area to work")
        assert (exc.value.status_code, exc.value.code) == (422, "PINCODE_OUTSIDE_FRANCHISEE")
        async with AsyncSessionLocal() as db:
            assert await snapshot(db, tid) == before

        out = await transfer("nisha", tid, C.p_id, reason="Needs a new area to work", pincodes=[C.p_codes[0]])
        assert out.coverage.added == [C.p_codes[0]] and out.coverage.trimmed == [C.s_codes[0]]
        async with AsyncSessionLocal() as db:
            assert await coverage_of(db, tid) == [C.p_codes[0]]
            t = await db.scalar(select(TechnicianTransfer).where(TechnicianTransfer.technician_id == tid))
            assert t.coverage_after == [C.p_codes[0]] and t.coverage_before == [C.s_codes[0]]
    run(_t())


def test_09_supplied_pincodes_outside_the_range_name_the_code_and_its_owner():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "S", [C.s_codes[0]])
            before = await snapshot(db, tid)
        with pytest.raises(AppError) as exc:
            await transfer("nisha", tid, C.p_id, reason="Needs a new area to work",
                           pincodes=[C.p_codes[0], C.s_codes[0]])
        assert (exc.value.status_code, exc.value.code) == (422, "PINCODE_OUTSIDE_FRANCHISEE")
        # the STAFF variant of the sentence: the owner is named
        assert C.s_codes[0] in exc.value.detail and "SkyFix Services" in exc.value.detail
        async with AsyncSessionLocal() as db:
            assert await snapshot(db, tid) == before
        # a code that is no pincode at all is a plain 422
        with pytest.raises(HTTPException) as exc2:
            await transfer("nisha", tid, C.p_id, reason="Needs a new area to work", pincodes=["999999"])
        assert exc2.value.status_code == 422
    run(_t())


def test_10_region_follows_the_coverage_and_two_regions_are_refused():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "S", [C.s_codes[0]])
            assert (await prof(db, tid)).region_id == w.region_id
            membership_id = (await prof(db, tid)).membership_id

        dry = await transfer("nisha", tid, C.r_id, dry=True, pincodes=C.r_codes[:2])
        assert dry.coverage.regionChanged is True and dry.coverage.regionBefore != dry.coverage.regionAfter
        applied = await transfer("nisha", tid, C.r_id, reason="Relocating to the far region", pincodes=C.r_codes[:2])
        assert applied.coverage.regionChanged is True
        async with AsyncSessionLocal() as db:
            assert (await prof(db, tid)).region_id == C.r_region_id
            regions = list(
                await db.scalars(select(MembershipRegion.region_id).where(MembershipRegion.membership_id == membership_id))
            )
            assert regions == [C.r_region_id]
        F["far"] = tid        # now outside Kiran's scope (used by #19)

        # two regions in one request: the target is home (it owns every unclaimed
        # code), so both codes route to it - and a technician works in one region.
        async with AsyncSessionLocal() as db:
            tid2, _ = await new_tech(db, "S", [C.s_codes[0]])
            before = await snapshot(db, tid2)
        dry = await transfer("nisha", tid2, w.home_id, dry=True, pincodes=[C.h_codes[0], C.r_spare])
        assert dry.canTransfer is False and dry.blockers[-1].code is None
        assert "more than one region" in dry.blockers[-1].message
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", tid2, w.home_id, reason="Covering two regions", pincodes=[C.h_codes[0], C.r_spare])
        assert exc.value.status_code == 422 and "more than one region" in exc.value.detail
        async with AsyncSessionLocal() as db:
            assert await snapshot(db, tid2) == before
    run(_t())


def test_11_back_to_home_keeps_only_what_nobody_owns():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "S", C.s_codes[:2])
            await drift(db, tid, C.h_codes[0])       # a code NOBODY owns (home's)
            F["back"] = tid
        out = await transfer("nisha", tid, w.home_id, reason="SkyFix ended its lease")
        assert out.coverage.kept == [C.h_codes[0]]
        assert out.coverage.trimmed == sorted(C.s_codes[:2])
        assert out.toFranchiseeIsHome is True
        async with AsyncSessionLocal() as db:
            assert (await prof(db, tid)).franchisee_id == w.home_id
            assert await coverage_of(db, tid) == [C.h_codes[0]]
        # only S's codes -> nothing left -> 422, exactly as for any target
        async with AsyncSessionLocal() as db:
            tid2, _ = await new_tech(db, "S", C.s_codes[:2])
        with pytest.raises(AppError) as exc:
            await transfer("nisha", tid2, w.home_id, reason="SkyFix ended its lease")
        assert exc.value.status_code == 422 and exc.value.code == "PINCODE_OUTSIDE_FRANCHISEE"
    run(_t())


# ── #12 / #13 / #14. the pool cut-over, money lands, the payer ───────────────


def test_12_pool_cut_over_assignment_and_covering():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "H", [C.h_codes[2]], upi=True)
            await drift(db, tid, C.s_codes[2])
            F["x"] = tid
            u = await raise_ticket(db, C.h_codes[2], index=4)     # stamped H
            t = await raise_ticket(db, C.s_codes[2], index=5)     # stamped S
            assert u.franchisee_id == w.home_id and t.franchisee_id == w.s_id
            F["u"], F["t"] = u.id, t.id
            await db.execute(update(TechnicianProfile).where(TechnicianProfile.id == tid)
                             .values(last_seen_at=datetime.datetime.now(datetime.timezone.utc)))
            await db.commit()

            async def pool_ids():
                offers, _ = await jobs_service.list_pool(
                    db, ListParams(page=1, limit=100), company_id=w.company_a_id, technician_id=tid
                )
                return {o.id for o in offers}

            before = await pool_ids()
            assert u.id in before and t.id not in before

        out = await transfer("nisha", tid, w.s_id, reason="Moved east; SkyFix runs his area")
        assert out.coverage.kept == [C.s_codes[2]] and out.coverage.trimmed == [C.h_codes[2]]

        async with AsyncSessionLocal() as db:
            offers, _ = await jobs_service.list_pool(
                db, ListParams(page=1, limit=100), company_id=w.company_a_id, technician_id=tid
            )
            after = {o.id for o in offers}
            assert F["t"] in after and F["u"] not in after
            # a stale accept of the old franchisee's ticket is a 404, not a cap message
            with pytest.raises(HTTPException) as exc:
                await jobs_service.accept(
                    db, F["u"], company_id=w.company_a_id, profile=await prof(db, tid),
                    background=BackgroundTasks(),
                )
            assert exc.value.status_code == 404
            with pytest.raises(HTTPException) as exc:
                await jobs_service.get_offer(db, F["u"], company_id=w.company_a_id, technician_id=tid)
            assert exc.value.status_code == 404

            # new tickets' pushes go to the NEW franchisee's technicians, him included
            tk = await db.get(Ticket, F["t"], populate_existing=True)
            covering = await technicians_covering(
                db, company_id=w.company_a_id, franchisee_id=tk.franchisee_id,
                routing_override=False, pincode=tk.pincode,
                node_path_ids=tk.node_path_ids,
            )
            assert tid in covering
            uk = await db.get(Ticket, F["u"], populate_existing=True)
            covering_u = await technicians_covering(
                db, company_id=w.company_a_id, franchisee_id=uk.franchisee_id,
                routing_override=False, pincode=uk.pincode,
                node_path_ids=uk.node_path_ids,
            )
            assert tid not in covering_u

            # Kiran assigning the old franchisee's ticket to him is refused...
            with pytest.raises(AppError) as exc:
                await tickets_service.assign_technician(db, await p(db, "kiran"), F["u"], technician_id=tid)
            assert (exc.value.status_code, exc.value.code) == (409, "TECHNICIAN_INELIGIBLE")
            assert "works for another franchisee" in exc.value.detail
            # ...the new one's is allowed.
            detail = await tickets_service.assign_technician(db, await p(db, "kiran"), F["t"], technician_id=tid)
            assert detail.status == "Assigned"
    run(_t())


def test_13_money_lands_where_it_should_and_14_the_payer():
    w = world()

    async def _t():
        tid = F["x"]
        async with AsyncSessionLocal() as db:
            row = await db.get(Ticket, F["t"], populate_existing=True)
            await customer_close(db, row)
            payout = await db.scalar(
                select(LedgerEntry).where(
                    LedgerEntry.technician_id == tid, LedgerEntry.kind == "payout"
                )
            )
            assert payout is not None and payout.franchisee_id == w.s_id

            # #14 he redeems after the move: stamped S, rung to S's admins, Nisha cannot act
            ravi = await prof(db, tid)
            card = await red_service.summary(db, ravi)
            assert card.payerLabel == "Franchisee Admin"
            owed = await redeemable_balance(db, company_id=w.company_a_id, technician_id=tid)
            red = await red_service.request(
                db, await tech_principal(db, tid), ravi, RedeemRequest(amountPaise=red_service.redeemable(owed))
            )
            stamp = await db.scalar(select(Redemption.franchisee_id).where(Redemption.id == red.id))
            assert stamp == w.s_id
            bell = (
                await db.execute(
                    text(
                        """SELECT audience, franchisee_id, pincode FROM notifications
                           WHERE kind = 'redemption' AND "to" = :to ORDER BY created_at DESC LIMIT 1"""
                    ).bindparams(to=f"/redemptions/{red.id}")
                )
            ).first()
            assert bell.audience == "franchisee_admin" and bell.franchisee_id == w.s_id
            assert await red_service.count_to_pay(db, await p(db, "priya")) >= 1
            with pytest.raises(AppError) as exc:
                await red_service.claim(
                    db, await p(db, "nisha"), red.id,
                    ClaimRequest(proof=ProofIn(blobName=f"attachment/{w.company_a_id}/t17/{red.id}/p.png"),
                                 utr=f"T17UTR{uuid.uuid4().hex[:10]}"),
                )
            assert exc.value.status_code == 404
            await red_service.decline(db, await p(db, "priya"), red.id, DeclineRequest(reason="Acceptance clean-up"))

        # the invariant of §7 #22 holds: nothing open is stamped with a stale franchisee
        # (scoped to this run's technicians: dev also holds an old open redemption
        # in another company - GTD-RDM-0001 - stamped with a franchisee its
        # technician has since left, which is not ours to judge.)
        async with AsyncSessionLocal() as db:
            stale = await db.scalar(
                text(
                    """SELECT count(*) FROM redemptions r JOIN technician_profiles tp ON tp.id = r.technician_id
                       WHERE r.franchisee_id <> tp.franchisee_id AND r.confirmed_at IS NULL AND r.declined_at IS NULL
                         AND tp.id = ANY(:ours)"""
                ).bindparams(ours=list(TECHS))
            )
            assert stale == 0
    run(_t())


# ── #16. an employee's statement splits at the move ──────────────────────────


def test_16_employee_statement_splits_by_franchisee():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "H", C.h_codes[:2], kind="employee")
            r1 = await raise_ticket(db, C.h_codes[0], index=6)
            await accept(db, await prof(db, tid), r1)
            pen_h = await cancel_job(db, await prof(db, tid), r1)
            assert pen_h.franchisee_id == w.home_id and pen_h.technician_type == "employee"
        # an employee has no redeemable money, so nothing blocks the move
        out = await transfer("nisha", tid, w.s_id, reason="Joining SkyFix's payroll", pincodes=[C.s_codes[3]])
        assert out.technicianType == "employee"
        async with AsyncSessionLocal() as db:
            r2 = await raise_ticket(db, C.s_codes[3], index=7)
            await accept(db, await prof(db, tid), r2)
            pen_s = await cancel_job(db, await prof(db, tid), r2)
            assert pen_s.franchisee_id == w.s_id
            now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)
            kw = dict(company_id=w.company_a_id, technician_id=tid, year=now.year, month=now.month)
            s_sheet = await load_statement(db, franchisee_id=w.s_id, **kw)
            h_sheet = await load_statement(db, franchisee_id=w.home_id, **kw)
            assert {r.ticket_code for r in s_sheet.rows if r.kind == "penalty"} == {r2.code}
            assert {r.ticket_code for r in h_sheet.rows if r.kind == "penalty"} == {r1.code}
    run(_t())


# ── #17. a pending UPI change travels and is re-addressed ────────────────────


def test_17_pending_upi_change_is_readdressed():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, name = await new_tech(db, "H", [C.h_codes[0]], upi=True)
            await tech_service.request_upi_change(
                db, await tech_principal(db, tid), UpiChangeRequestIn(upiId=f"new{uuid.uuid4().hex[:6]}@ybl", upiName=name)
            )
            row = await db.scalar(
                select(UpiChangeRequest).where(UpiChangeRequest.technician_id == tid, UpiChangeRequest.status == "pending")
            )
            assert row.reviewer_role in ("area_manager", "regional_head", "national_head", "admin")
            to = f"/technicians/{tid}"
            kiran_before, _ = await notif_service.list_page(db, await p(db, "kiran"), page=1, limit=100, kind="upi_change")
            kiran_before = [n for n in kiran_before if n.to == to]

        dry = await transfer("nisha", tid, w.s_id, dry=True, pincodes=[C.s_codes[4]])
        assert any("UPI change is waiting" in x for x in dry.warnings)
        await transfer("nisha", tid, w.s_id, reason="Moved under SkyFix", pincodes=[C.s_codes[4]])

        async with AsyncSessionLocal() as db:
            row = await db.scalar(
                select(UpiChangeRequest).where(UpiChangeRequest.technician_id == tid, UpiChangeRequest.status == "pending")
            )
            assert row is not None and row.reviewer_role == "franchisee_admin"
            bell = await db.scalar(
                select(Notification)
                .where(Notification.kind == "upi_change", Notification.to == f"/technicians/{tid}")
                .order_by(Notification.created_at.desc())
            )
            assert (bell.audience, bell.franchisee_id) == ("franchisee_admin", w.s_id)
            priya_rows, _ = await notif_service.list_page(db, await p(db, "priya"), page=1, limit=100, kind="upi_change")
            assert any(n.to == f"/technicians/{tid}" for n in priya_rows)
            kiran_after, _ = await notif_service.list_page(db, await p(db, "kiran"), page=1, limit=100, kind="upi_change")
            assert len([n for n in kiran_after if n.to == f"/technicians/{tid}"]) == len(kiran_before)
            queue, _ = await tech_service.list_upi_changes(db, await p(db, "priya"), ListParams(page=1, limit=100), state="pending")
            assert any(r.technicianId == tid for r in queue)
            # Tidy up: the technician takes the request back, so S's pending
            # queue is not left longer for the suites that count it (Task 05 #8).
            await tech_service.withdraw_upi_change(db, await tech_principal(db, tid))
            assert await db.scalar(
                select(func.count()).select_from(UpiChangeRequest).where(
                    UpiChangeRequest.technician_id == tid, UpiChangeRequest.status == "pending")
            ) == 0
    run(_t())


# ── #19. authorization and tenancy ───────────────────────────────────────────


async def run_guards(path: str, method: str, principal: Principal, db) -> None:
    """Call the guards of the REAL route, in order - what FastAPI would run
    before the handler (they live in `dependencies=[...]`, never a stacked alias)."""
    route = next(
        r for r in technicians_router.routes
        if getattr(r, "path", None) == path and method in getattr(r, "methods", set())
    )
    for d in route.dependencies:
        fn = d.dependency
        args = (principal, db) if "db" in inspect.signature(fn).parameters else (principal,)
        result = fn(*args)
        if inspect.isawaitable(result):
            await result


def test_19_authorization_and_tenancy():
    w = world()

    async def _t():
        path_post, path_get = "/technicians/{technician_id}/transfer", "/technicians/{technician_id}/transfers"
        async with AsyncSessionLocal() as db:
            await run_guards(path_post, "POST", await p(db, "nisha"), db)         # passes
            await run_guards(path_post, "POST", await p(db, "admin"), db)         # passes
            for who in ("kiran", "priya", "vendor"):
                with pytest.raises(HTTPException) as exc:
                    await run_guards(path_post, "POST", await p(db, who), db)
                assert exc.value.status_code == 403, who
            tech_p = await tech_principal(db, F["x"])
            with pytest.raises(HTTPException) as exc:
                await run_guards(path_post, "POST", tech_p, db)
            assert exc.value.status_code == 403
            # a Feature Access override cannot hand it to a franchise account: the
            # floor and the staff door refuse independently of the feature.
            from app.core.deps import require_min_rank, require_staff_principal

            priya = await p(db, "priya")
            with pytest.raises(HTTPException) as exc:
                require_staff_principal(priya)
            assert exc.value.status_code == 403
            with pytest.raises(HTTPException) as exc:
                require_min_rank(NATIONAL_HEAD)(priya)
            assert exc.value.status_code == 403
            assert ROLE_RANKS["franchisee_admin"] > ROLE_RANKS[NATIONAL_HEAD]

            # history: Kiran (AM) passes the guards, Priya does not
            await run_guards(path_get, "GET", await p(db, "kiran"), db)
            with pytest.raises(HTTPException) as exc:
                await run_guards(path_get, "GET", priya, db)
            assert exc.value.status_code == 403

        # 404, never 403, for what is not ours
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", uuid.uuid4(), C.p_id, dry=True)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", F["x"], uuid.uuid4(), dry=True)
        assert exc.value.status_code == 404 and "Franchisee" in exc.value.detail
        # company B's franchisee id from company A's principal; company A's
        # technician from company B's principal
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", F["x"], w.home_b_id, dry=True)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await transfer("bala", F["x"], w.home_b_id, dry=True)
        assert exc.value.status_code == 404
        # a DELETED franchisee is a 404
        async with AsyncSessionLocal() as db:
            tag = uuid.uuid4().hex[:5].upper()
            gone = await franchisees_service.create_franchisee(
                db, await p(db, "admin"),
                FranchiseeCreateRequest(
                    name=f"T17 Gone {tag}", code=f"GX{tag}", kind="external",
                    contactName="T17 Contact", contactPhone=_phone(950 + random.randint(0, 40)),
                ),
            )
            await db.execute(update(Franchisee).where(Franchisee.id == gone.id).values(
                deleted_at=datetime.datetime.now(datetime.timezone.utc)))
            await db.commit()
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", F["x"], gone.id, dry=True)
        assert exc.value.status_code == 404

        # history scope: in scope 200, out of scope (moved to the far region) 404
        async with AsyncSessionLocal() as db:
            rows = await transfer_service.list_transfers(db, await p(db, "kiran"), F["d1"])
            assert rows
            with pytest.raises(HTTPException) as exc:
                await transfer_service.list_transfers(db, await p(db, "kiran"), F["far"])
            assert exc.value.status_code == 404
            with pytest.raises(HTTPException) as exc:
                await transfer_service.list_transfers(db, await p(db, "bala"), F["d1"])
            assert exc.value.status_code == 404
    run(_t())


# ── #20. validation ──────────────────────────────────────────────────────────


def test_20_validation():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, name = await new_tech(db, "H", [C.h_codes[0]])
            before = await snapshot(db, tid)
        # a short or missing reason: 422 on apply, fine on a dry run
        for bad in ("abcd", "    ", None):
            with pytest.raises(HTTPException) as exc:
                await transfer("nisha", tid, C.n_id, reason=bad, pincodes=[C.n_codes[0]])
            assert exc.value.status_code == 422 and "at least 5 characters" in exc.value.detail
        out = await transfer("nisha", tid, C.p_id, dry=True, pincodes=[C.p_codes[0]])
        assert out.canTransfer is True
        # the current franchisee: a code-less 409
        out = await transfer("nisha", tid, w.home_id, dry=True)
        assert codes_of(out) == [None] and "already works for" in out.blockers[0].message
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", tid, w.home_id, reason="Same place again")
        assert exc.value.status_code == 409 and not isinstance(exc.value, AppError)
        # an inactive target
        with pytest.raises(HTTPException) as exc:
            await transfer("nisha", tid, C.d_id, reason="Into a dormant one", pincodes=[C.p_codes[0]])
        assert exc.value.status_code == 409 and "Activate T17 Dormant" in exc.value.detail
        # a non-home target with NO admin
        out = await transfer("nisha", tid, C.n_id, dry=True, pincodes=[C.n_codes[0]])
        assert "FRANCHISEE_HAS_NO_ADMIN" in codes_of(out)
        with pytest.raises(AppError) as exc:
            await transfer("nisha", tid, C.n_id, reason="Into one nobody runs", pincodes=[C.n_codes[0]])
        assert (exc.value.status_code, exc.value.code) == (409, "FRANCHISEE_HAS_NO_ADMIN")
        async with AsyncSessionLocal() as db:
            assert await snapshot(db, tid) == before
        # the admin role may do it too (franchisees.manage is Admin / NH)
        out = await transfer("admin", tid, C.p_id, reason="Admin moves him too", pincodes=[C.p_codes[0]])
        assert out.transfer is not None and out.transfer.byName
    run(_t())


# ── #21. history, and the verify check ───────────────────────────────────────


def test_21_history_newest_first_and_the_verify_check():
    w = world()

    async def _t():
        # a technician with two moves: H -> S -> H
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "H", [C.h_codes[0]])
        await transfer("nisha", tid, w.s_id, reason="First move into SkyFix", pincodes=[C.s_codes[0]])
        await asyncio.sleep(0.05)
        await transfer("nisha", tid, w.home_id, reason="Second move back home", pincodes=[C.h_codes[1]])
        async with AsyncSessionLocal() as db:
            rows = await transfer_service.list_transfers(db, await p(db, "nisha"), tid)
            assert [r.reason for r in rows] == ["Second move back home", "First move into SkyFix"]
            newest = rows[0]
            assert newest.fromFranchiseeName == "SkyFix Services" and newest.toFranchiseeId == w.home_id
            assert newest.byName == "Nisha Kulkarni"
            assert newest.added == [C.h_codes[1]] and newest.trimmed == [C.s_codes[0]] and newest.kept == []

            # the verify check passes on a consistent world...
            assert await seed_verify._transfers_agree_with_technicians(db, w.company_a_id) == []
            # ...and notices a profile that disagrees with its newest move (rolled back)
            await db.execute(update(TechnicianProfile).where(TechnicianProfile.id == tid)
                             .values(franchisee_id=w.s_id))
            problems = await seed_verify._transfers_agree_with_technicians(db, w.company_a_id)
            assert any(str(tid) in pr.detail for pr in problems)
            await db.rollback()
    run(_t())


# ── #22. concurrency ─────────────────────────────────────────────────────────


def test_22_two_applies_at_once_exactly_one_wins():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            tid, _ = await new_tech(db, "H", [C.h_codes[0]])
        results = await asyncio.gather(
            transfer("nisha", tid, w.s_id, reason="Racing to the same place", pincodes=[C.s_codes[0]]),
            transfer("nisha", tid, w.s_id, reason="Racing to the same place", pincodes=[C.s_codes[0]]),
            return_exceptions=True,
        )
        wins = [r for r in results if not isinstance(r, BaseException)]
        losses = [r for r in results if isinstance(r, BaseException)]
        assert len(wins) == 1 and len(losses) == 1, results
        assert isinstance(losses[0], HTTPException) and losses[0].status_code == 409
        assert not isinstance(losses[0], AppError)       # code-less
        assert "already works for" in losses[0].detail
        async with AsyncSessionLocal() as db:
            n = await db.scalar(select(func.count()).select_from(TechnicianTransfer).where(TechnicianTransfer.technician_id == tid))
            assert n == 1
            assert (await prof(db, tid)).franchisee_id == w.s_id
    run(_t())
