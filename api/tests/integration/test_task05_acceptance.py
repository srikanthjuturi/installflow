"""Task 05 §7 acceptance — the cast seeded by `app.scripts.seed_task05`, driven
through the SERVICE layer against RelianceDB (dev), exactly as
`test_franchisee_flow.py` runs: hand-built `Principal`s, a fresh session per
segment, no HTTP. Run with:

    cd api
    .venv/Scripts/python.exe -m pytest tests/integration/test_task05_acceptance.py -v

Order matters and is stated in the section notes: the roster facts (#2-#6) run
first, #7's type switch turns Ravi into a freelancer (a fact every later
ledger stamp carries), the money scenario (#10) then drives five real tickets
and Hema's two home flows, and the last tests read the world that walk left
behind. Everything find-or-created by the seeder is reused on a re-run; the
money the tests themselves move is new every run — which is how a real world
behaves too.
"""

import asyncio
import dataclasses
import datetime
import sys
import uuid

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from sqlalchemy import select, text, update  # noqa: E402

from app.core.coverage import users_notified_by  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import (  # noqa: E402
    Principal,
    require_any_feature,
    require_feature,
    require_staff_principal,
)
from app.core.errors import AppError  # noqa: E402
from app.core.franchise_money import money_context, pool_franchisee  # noqa: E402
from app.core.ledger import pool as core_pool  # noqa: E402
from app.core.ledger import redeemable_balance as core_ledger_balance  # noqa: E402
from app.core.ledger import pool_arithmetic  # noqa: E402
from app.core.schemas import ListParams  # noqa: E402
from app.core.vendor_credits import standing as vendor_standing  # noqa: E402
from app.features.franchise_portal import service as portal_service  # noqa: E402
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.ledger import router as ledger_router  # noqa: E402
from app.features.ledger import service as ledger_service  # noqa: E402
from app.features.notifications import service as notif_service  # noqa: E402
from app.features.redemptions import service as red_service  # noqa: E402
from app.features.redemptions.schemas import (  # noqa: E402
    ClaimRequest,
    DeclineRequest,
    ProofIn,
    RedeemRequest,
)
from app.features.tickets import feedback_service  # noqa: E402
from app.features.tickets.sweeps import sweep_unaccepted  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import (  # noqa: E402
    ForceCloseAttachmentIn,
    ForceCloseRequest,
    TicketCreateRequest,
)
from app.features.technicians import service as tech_service  # noqa: E402
from app.features.technicians.schemas import (  # noqa: E402
    TechnicianCreateRequest,
    TechnicianUpdateRequest,
    UpiChangeRequestIn,
    UpiRejectRequest,
)
from app.models.feature import CompanyRoleFeature, Feature  # noqa: E402
from app.models.redemption import Redemption  # noqa: E402
from app.models.ledger import LedgerEntry  # noqa: E402
from app.models.technician import TechnicianPincode, TechnicianProfile  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from app.models.territory import Pincode, State  # noqa: E402
from app.scripts import seed_task05  # noqa: E402
from app.scripts.seed.guards import synthetic_phone  # noqa: E402
from app.scripts.seed.lifecycle import _artifacts as seed_artifacts  # noqa: E402
from app.scripts.seed.tenant import phone_block  # noqa: E402


# ── the world, the cast, and the state the tests hand each other ──────────

_W: seed_task05.World | None = None


def world() -> seed_task05.World:
    global _W
    if _W is None:
        async def _b():
            async with AsyncSessionLocal() as db:
                return await seed_task05.build(db)
        _W = asyncio.run(_b())
    return _W


def run(coro):
    asyncio.run(coro)


@dataclasses.dataclass
class Facts:
    #: Written in file order by the tests that drive the flows; read by those
    #: after them. One pytest run's own artifacts — never the seeder's.
    t_assign: uuid.UUID | None = None   # #7 — accepted, then closed normally
    t_cancel: uuid.UUID | None = None   # #10a — penalty via cancellation
    t_noshow: uuid.UUID | None = None   # #10b — penalty via a confirmed no-show
    t_bonus: uuid.UUID | None = None    # #10c — bonus funded, then completed
    t_close: uuid.UUID | None = None    # #10d — the customer closed
    t_force: uuid.UUID | None = None    # #10e — the manager force-closed
    t_hema: uuid.UUID | None = None     # #10f — Hema's HOME penalty
    t_hema_paid: uuid.UUID | None = None  # #10g — Hema's completed payout

    #: Every money-flow ticket this run raised, in the order they happened.
    tickets: list[uuid.UUID | None] = dataclasses.field(default_factory=list)
    ravi_penalty: uuid.UUID | None = None
    ravi_penalty2: uuid.UUID | None = None
    hema_penalty: uuid.UUID | None = None


FACTS = Facts()
BONUS_PAISE = 10_000  # ₹100 the manager funds, on the escalation screen


def _phone(base: int) -> str:
    return synthetic_phone(phone_block("t05-integration") + base)


def _lata_phone(tag: str, offset: int = 7) -> str:
    return synthetic_phone(phone_block(f"t05-lata-{tag}") + offset)


async def p(db, key: str) -> Principal:
    """One named cast member, resolved fresh in THIS session."""
    w = world()
    if key == "priya":
        return await seed_task05.principal_by_email(db, w.priya_email, w.company_a_id)
    if key == "hari":
        return await seed_task05.principal_by_email(db, w.hari_email, w.company_a_id)
    if key == "uma":
        return await seed_task05.principal_by_email(db, w.uma_email, w.company_a_id)
    if key == "bala":
        return await seed_task05.principal_by_email(
            db, w.bala_email, w.company_b_id
        )
    if key == "kiran":
        return await seed_task05.principal_by_email(db, w.kiran_email, w.company_a_id)
    if key == "nisha":
        return await seed_task05.principal_by_email(db, w.nisha_email, w.company_a_id)
    if key == "ravi":
        return await seed_task05.technician_principal(db, w.ravi_id, w.company_a_id)
    if key == "hema":
        return await seed_task05.technician_principal(db, w.hema_id, w.company_a_id)
    if key == "vendor":
        user = await seed_task05._user_by_email(db, w.vendor_email)
        return Principal(
            user=user,
            role=user.role,
            rank=0,
            is_superadmin=False,
            company_id=w.company_a_id,
            vendor_id=w.vendor_id,
        )
    if key == "admin":
        return await seed_task05._principal_for(
            db, await seed_task05._user_by_email(db, w.company_a_admin_email),
            w.company_a_id,
        )
    raise KeyError(key)


async def profile(db, w, which: str) -> TechnicianProfile:
    return await db.get(
        TechnicianProfile,
        w.ravi_id if which == "ravi" else w.hema_id,
        populate_existing=True,
    )


def _404(exc) -> bool:
    """Both families of 404 this codebase raises say the same status."""
    return getattr(exc.value, "status_code", None) == 404


_NOT_FOUND_ERRORS = (AppError, HTTPException)


# ── ticket helpers — the real hands the money comes from ──────────────────


_HEADROOM_PAISE = 10_000_000  # ₹1,00,000 — room for a whole run's money walk


async def ensure_vendor_headroom(db) -> None:
    """The vendor's line must hold the run's tickets. Leftover open tickets
    from an earlier interrupted run sit on the ₹5,000 the seeder's vendor was
    born with, and the refusal the line gives is the PRODUCT behaving right —
    so the harness buys room the way a person would: the admin raises the
    vendor's agreed limit (an ordinary vendor edit, `vendors.update_vendor`).
    The new limit is sized to the debt, not to a constant: a line has to
    carry what is already owed plus what is reserved on open tickets, with
    the run's headroom over it — otherwise every crashed run's leftovers
    eventually eat any fixed figure."""
    line = await vendor_standing(db, world().company_a_id, world().vendor_id)
    needed = (
        line.used_paise + line.reserved_paise + _HEADROOM_PAISE
    )
    if line.limit_paise < needed:
        from app.features.vendors import service as vendors_service
        from app.features.vendors.schemas import VendorUpdateRequest

        w = world()
        admin = await seed_task05._principal_for(
            db, await seed_task05._user_by_email(db, w.company_a_admin_email),
            w.company_a_id,
        )
        await vendors_service.update_vendor(
            db, admin, w.vendor_id,
            VendorUpdateRequest(creditLimitPaise=needed),
        )


async def raise_penalty_ceiling(db, w) -> None:
    """The walk charges real cancellations, and the cast's IST month already
    carries every earlier run's leftovers: the ₹5,000-a-month cap — the
    company's own rule — is long spent, so a charge comes back as an honest
    ₹0 and the ledger gets no row (`jobs.service.cancel`, charge > 0 guard).
    The admin buys room the ordinary way: Rules Config → cancellation cap,
    up to the platform's rupee ceiling. A rule a company may genuinely hold;
    the walk only needs it to still be a charge."""
    from app.features.settings import service as settings_service
    from app.features.settings.schemas import RulesUpdateRequest

    current = await settings_service.get_rules(db, w.company_a_id)
    values = current.model_dump()
    # The read side answers bands as {band, amount} for the screen; the write
    # side takes the amounts alone.
    values["penalty"] = [b.amount for b in current.penalty]
    values["penaltyCap"] = 1_000_000
    body = RulesUpdateRequest(**values)
    await settings_service.update_rules(db, await p(db, "admin"), body)


async def raise_ticket(db, w, tech_profile, *, index: int, confirm: bool = True):
    """A vendor raises one ticket aimed at ONE of the technician's own codes."""
    codes = list(
        await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.technician_id == tech_profile.id
            )
        )
    )
    assert codes, f"no coverage rows for technician {tech_profile.id}"
    await ensure_vendor_headroom(db)
    today = datetime.datetime.now(datetime.timezone.utc).date()
    body = TicketCreateRequest(
        subcategoryId=w.leaf_id,
        modelId=w.model_id,
        serviceType=w.service_types[0],
        serialNumber=f"T05{index:06d}{uuid.uuid4().hex[:4].upper()}",
        customerName="Integration Customer",
        customerPhone=_phone(50_000 + index),
        address=f"Flat {index}, Green Park Residency",
        city="Hyderabad",
        state="Telangana",
        pincode=codes[0],
        expectedDate=today + datetime.timedelta(days=1),
        serviceLevelHours=48,
    )
    created = await tickets_service.create_ticket(db, await p(db, "vendor"), body)
    row = await db.get(Ticket, created.id)
    if confirm:
        await confirm_earliest(db, row)
        await db.refresh(row)
    return row


async def confirm_earliest(db, row: Ticket):
    """The customer picks the earliest window — the dearest penalty band."""
    from app.core.slots import bookable_slots

    windows = await bookable_slots(db, row)
    assert windows, "no slot windows offered for this ticket"
    await tickets_service.confirm_slot(db, row.slot_token, windows[0][0])
    await db.refresh(row)


async def clear_open_redemptions(db, w, tech_profile, tech_key: str) -> None:
    """Re-run hygiene: a crashed run leaves the technician's redemption OPEN,
    and the product rightly refuses a second while one is open — "paid and
    confirmed, or declined". The two doors that close it are real ones: the
    payer declines a nobody-has-paid-it row, and the technician confirms the
    arrival of one somebody has claimed. Both through the services."""
    from app.features.redemptions import service as red_svc

    rows = (
        await db.scalars(
            select(Redemption).where(
                Redemption.company_id == w.company_a_id,
                Redemption.technician_id == tech_profile.id,
                Redemption.confirmed_at.is_(None),
                Redemption.declined_at.is_(None),
            )
        )
    ).all()
    for stale in rows:
        if stale.claimed_at is None:
            await red_svc.decline(
                db, await p(db, "priya"), stale.id,
                DeclineRequest(reason="Acceptance run — clearing an open ask."),
            )
        else:
            await red_svc.confirm(
                db, await p(db, tech_key), tech_profile, stale.id, received=True
            )


async def clear_open_jobs(db, w) -> None:
    """Re-run hygiene: an INTERRUPTED run left tickets still Assigned to / In
    Progress with the walk's technicians, and the product rightly refuses
    everything that follows — a type flip over an open job is 409, and every
    window the person holds eats one out of an offered reschedule list. Closing
    them through the ordinary completion walk is the honest door, and it pays
    the technician for the work (real rows, real money), which also keeps the
    redemption tests' balance above zero."""
    for which in ("ravi", "hema"):
        prof = await profile(db, w, which)
        open_ones = list(
            await db.scalars(
                select(Ticket).where(
                    Ticket.company_id == w.company_a_id,
                    Ticket.technician_id == prof.id,
                    Ticket.status.in_(("Assigned", "In Progress")),
                    Ticket.deleted_at.is_(None),
                )
            )
        )
        for row in open_ones:
            tech = await db.get(
                TechnicianProfile, row.technician_id, populate_existing=True
            )
            if row.status == "Assigned":
                await jobs_service.submit_proof(
                    db,
                    row.id,
                    company_id=w.company_a_id,
                    profile=tech,
                    artifacts=seed_artifacts(w.company_a_id, row),
                    observed_serial=row.serial_number,
                    observed_serial_source="scanned",
                )
                await db.refresh(row)
            await jobs_service.complete(
                db, row.id, company_id=w.company_a_id, profile=tech
            )
            await db.refresh(row)
            assert row.feedback_token, "no feedback token after complete"
            await feedback_service.record_feedback(
                db, row.feedback_token, confirmed=True, rating=5,
                comment="Acceptance run — clearing a leftover job.",
            )
            await db.refresh(row)


async def drain_balance(db, w, which: str) -> None:
    """Settle money the technician is owed but never asked for — what an
    earlier run that died before its redemption settled left behind. T4's R5
    refuses a freelancer→employee switch over unredeemed freelancer money, and
    #7 must flip Ravi to employee before it can raise the open-job 409."""
    prof = await profile(db, w, which)
    await clear_open_redemptions(db, w, prof, which)
    available = await core_ledger_balance(
        db,
        company_id=w.company_a_id,
        technician_id=w.ravi_id if which == "ravi" else w.hema_id,
    )
    amount = red_service.redeemable(available)
    if amount <= 0:
        return
    out = await red_service.request(
        db, await p(db, which), prof, RedeemRequest(amountPaise=amount)
    )
    payer = {"ravi": "priya", "hema": "hari"}[which]
    await red_service.claim(
        db, await p(db, payer), out.id,
        ClaimRequest(proof=_proof(w.company_a_id, out.id), utr=f"T05DRAIN{out.id}"),
    )
    await red_service.confirm(db, await p(db, which), prof, out.id, received=True)


async def top_up_earnings(db, w, which: str) -> None:
    """Repair a technician whose redemption history is AHEAD of their pay:
    runs that died before their redemption settled left `reserved` counting
    money `credited` never got back, and no product door claws reserved money
    out — a settled ask is settled. The top-up is the honest one: a real
    escalated job, funded with a real bonus by the pool's own payer, taken and
    completed by the same walk #10c drives. Credited rises past reserved, and
    the balance is again something a redemption may be asked for."""
    prof = await profile(db, w, which)
    tech_id = w.ravi_id if which == "ravi" else w.hema_id
    available = await core_ledger_balance(
        db, company_id=w.company_a_id, technician_id=tech_id
    )
    if red_service.redeemable(available) > 0:
        return
    row = await raise_ticket(db, w, prof, index=21)
    soon = datetime.datetime.now(datetime.timezone.utc)
    await db.execute(
        update(Ticket)
        .where(Ticket.id == row.id)
        .values(
            slot_start=soon + datetime.timedelta(hours=1),
            slot_end=soon + datetime.timedelta(hours=2),
        )
    )
    await db.commit()
    await sweep_unaccepted(db)
    await db.refresh(row)
    assert row.status == "Escalated", row.status
    # The completion's own payout adds ~₹600 more on top of the bonus, so a
    # ₹300 margin over the shortfall settles it regardless.
    need = -available + 30_000
    funder = "kiran" if which == "ravi" else "hari"
    await tickets_service.add_bonus_and_renotify(
        db, await p(db, funder), row.id, amount_paise=need
    )
    await accept_job(db, w, prof, row)
    await customer_close(db, w, row)


async def accept_job(db, w, tech_profile, row: Ticket) -> Ticket:
    background = BackgroundTasks()
    await jobs_service.accept(
        db,
        row.id,
        company_id=w.company_a_id,
        profile=tech_profile,
        background=background,
    )
    await db.refresh(row)
    return row


async def customer_close(db, w, row: Ticket, rating: int = 5) -> Ticket:
    """The full completion walk: proof, technician-complete, customer feedback."""
    tech = await db.get(TechnicianProfile, row.technician_id, populate_existing=True)
    await jobs_service.submit_proof(
        db,
        row.id,
        company_id=w.company_a_id,
        profile=tech,
        artifacts=seed_artifacts(w.company_a_id, row),
        observed_serial=row.serial_number,
        observed_serial_source="scanned",
    )
    await db.refresh(row)
    await jobs_service.complete(db, row.id, company_id=w.company_a_id, profile=tech)
    await db.refresh(row)
    assert row.feedback_token, "no feedback token after complete"
    await feedback_service.record_feedback(
        db, row.feedback_token, confirmed=True, rating=rating,
        comment="Acceptance run.",
    )
    await db.refresh(row)
    return row


def _proof(cid, rid) -> ProofIn:
    return ProofIn(blobName=f"attachment/{cid}/acceptance/{rid}/proof.png")


# ── #2. Portal create ─────────────────────────────────────────────────────


def test_02_portal_create_and_stamps():
    """Priya registers through the portal door: the profile carries HER
    franchisee, the type SHE chose, and the region DERIVED from her own
    coverage — the same facts Ravi's seeder-created row must already show."""
    w = world()  # noqa: F841 — loaded before any session touches it

    async def _t():
        async with AsyncSessionLocal() as db:
            w = world()
            ravi = await db.get(TechnicianProfile, w.ravi_id)
            assert str(ravi.franchisee_id) == str(w.s_id)
            # The TYPE the door stamps is one of the two legal values. Which
            # one Ravi carries is a moveable fact: #7 flips it, a previous
            # run's #7 may already have, and #10 pins it per ledger row at
            # write time — that test is the acceptance for the type itself.
            assert ravi.technician_type in ("employee", "freelancer")

            region_id = (
                await db.execute(
                    select(State.region_id)
                    .join(Pincode, Pincode.state_id == State.id)
                    .where(Pincode.code == w.s_pincodes[0])
                )
            ).scalar_one_or_none()
            assert region_id == w.region_id, region_id

            # A second hire through the same door, THIS RUN: same stamps.
            tag = uuid.uuid4().hex[:6]
            created = await tech_service.create_technician(
                db,
                await p(db, "priya"),
                TechnicianCreateRequest(
                    fullName=f"Lata Hire {tag}",
                    phone=_lata_phone(tag),
                    subcategoryIds=[w.leaf_id],
                    pincodes=w.s_pincodes[:2],
                    technicianType="freelancer",
                ),
            )
            lata = await db.get(TechnicianProfile, created.id)
            assert lata is not None
            assert str(lata.franchisee_id) == str(w.s_id)
            assert lata.technician_type == "freelancer"
    run(_t())


def test_02b_portal_create_two_regions_422():
    """Coverage spanning two regions with no regionId — the screen's question."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            outside = (
                await db.execute(
                    select(Pincode.code)
                    .join(State, State.id == Pincode.state_id)
                    .where(
                        State.region_id != w.region_id,
                        Pincode.is_active.is_(True),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            assert outside, "a second active region is needed to ask this"
            tag = uuid.uuid4().hex[:6]
            with pytest.raises((AppError, HTTPException)) as exc:
                await tech_service.create_technician(
                    db,
                    await p(db, "priya"),
                    TechnicianCreateRequest(
                        fullName=f"Two Region Hire {tag}",
                        phone=_lata_phone(tag, 8),
                        subcategoryIds=[w.leaf_id],
                        pincodes=[w.s_pincodes[0], outside],
                    ),
                )
            assert exc.value.status_code == 422
            message = str(
                getattr(exc.value, "detail", None) or getattr(exc.value, "message", "")
            )
            assert "region" in message.lower()
    run(_t())


# ── #3. The range ─────────────────────────────────────────────────────────


def test_03_range_wall_names_the_code_not_the_owner():
    """Priya's wall names the code that is not hers — and says nothing about
    who else owns it."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            home_code = w.hema_pincodes[0]  # unclaimed here → routes home
            with pytest.raises(AppError) as exc:
                await tech_service.create_technician(
                    db,
                    await p(db, "priya"),
                    TechnicianCreateRequest(
                        fullName="Range Hire",
                        phone=_phone(5),
                        subcategoryIds=[w.leaf_id],
                        pincodes=[home_code],
                    ),
                )
            assert exc.value.status_code == 422
            assert exc.value.code == "PINCODE_OUTSIDE_FRANCHISEE"
            assert home_code in exc.value.detail
            assert "SkyFix" not in exc.value.detail  # not HER answer to name
    run(_t())


def test_03b_range_wall_on_the_staff_door():
    """Kiran (staff) cannot hire into S's codes either — the same 422."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            with pytest.raises(AppError) as exc:
                await tech_service.create_technician(
                    db,
                    await p(db, "kiran"),
                    TechnicianCreateRequest(
                        fullName="Range Hire AM",
                        phone=_phone(6),
                        subcategoryIds=[w.leaf_id],
                        pincodes=[w.s_pincodes[0]],
                    ),
                )
            assert exc.value.status_code == 422
            assert exc.value.code == "PINCODE_OUTSIDE_FRANCHISEE"
    run(_t())


# ── #4. The franchise wall — other franchisees read as nobody ─────────────


def test_04_wall_other_admins_get_404():
    """Bala (company B) and Uma (S's sibling T) get 404, never 403, on every
    franchise door that names Ravi — a guessed id and a real answer are
    indistinguishable."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            for who in ("bala", "uma"):
                actor = await p(db, who)
                assert actor.is_franchise
                assert actor.franchisee_id not in (None, w.s_id)

                with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                    await tech_service.get_technician(db, actor, w.ravi_id)
                assert _404(exc)

                with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                    await tech_service.update_technician(
                        db, actor, w.ravi_id, TechnicianUpdateRequest(dailyJobCap=4)
                    )
                assert _404(exc)

                with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                    await tech_service.delete_technician(db, actor, w.ravi_id)
                assert _404(exc)

                with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                    await tech_service.approve_upi_change(db, actor, w.ravi_id)
                assert _404(exc)

                # Door 2's own loader, with an entry id named by hand.
                with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                    await ledger_service.reverse_entry(
                        db, actor, uuid.uuid4(), "not theirs"
                    )
                assert _404(exc)
    run(_t())


# ── #5. Staff read, no write ──────────────────────────────────────────────


def test_05_staff_reads_without_managing():
    """Kiran reads Ravi on his own screen with `canManage: false` and NO UPI
    ID; Nisha sees the UPI ID but still cannot manage; both PUTs are 403
    naming the wall; Hema (home's) Kiran CAN edit."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # A wide page, not the default 20: every earlier run hired one
            # more Lata (test_02 is a real hire per run), the list orders
            # newest-first, and Ravi — the oldest row in the cast — falls off
            # page 1 once twenty rows sit above him. The list is not the fact
            # under test; who RAVI is to each reader is.
            wide = ListParams(limit=200)
            kiran = await p(db, "kiran")
            rows, _total = await tech_service.list_technicians(
                db, kiran, wide, pincode=w.s_pincodes[0]
            )
            hits = [r for r in rows if str(r.id) == str(w.ravi_id)]
            assert hits, f"Ravi invisible to Kiran at pincode {w.s_pincodes[0]}"
            assert hits[0].canManage is False
            assert not hits[0].upiId

            nisha = await p(db, "nisha")
            rows2, _ = await tech_service.list_technicians(
                db, nisha, wide, pincode=w.s_pincodes[0]
            )
            hits2 = [r for r in rows2 if str(r.id) == str(w.ravi_id)]
            assert hits2 and hits2[0].canManage is False
            assert hits2[0].upiId == "ravit05@ybl"

            for actor in (kiran, nisha):
                with pytest.raises(HTTPException) as exc:
                    await tech_service.update_technician(
                        db, actor, w.ravi_id, TechnicianUpdateRequest(dailyJobCap=3)
                    )
                assert exc.value.status_code == 403
                assert "SkyFix Services" in str(getattr(exc.value, "detail", ""))

            rows3, _ = await tech_service.list_technicians(
                db, kiran, wide, pincode=w.hema_pincodes[0]
            )
            hema = [r for r in rows3 if str(r.id) == str(w.hema_id)]
            assert hema and hema[0].canManage is True
            out = await tech_service.update_technician(
                db, kiran, w.hema_id, TechnicianUpdateRequest(dailyJobCap=5)
            )
            assert str(out.id) == str(w.hema_id)
    run(_t())


# ── #6. The staff door refuses franchise roles ────────────────────────────


def test_06_staff_door_refuses_franchise_role_even_with_the_feature():
    """The staff door is a ROLE test: a Feature Access grant to Priya's role
    cannot lift her over a wall that exists to keep grant-keys out of it."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            feature_id = (
                await db.execute(select(Feature.id).where(Feature.key == "technicians.view"))
            ).scalar_one_or_none()
            assert feature_id is not None
            grant = CompanyRoleFeature(
                company_id=w.company_a_id,
                role="franchisee_admin",
                feature_id=feature_id,
                enabled=True,
            )
            db.add(grant)
            await db.commit()
            try:
                with pytest.raises(HTTPException) as exc:
                    require_staff_principal(await p(db, "priya"))
                assert exc.value.status_code == 403
            finally:
                await db.delete(grant)
                await db.commit()
    run(_t())


# ── #7. The type guard ────────────────────────────────────────────────────


def test_07_type_guard_open_job_then_200():
    """Ravi holds an Assigned job: the switch is 409 `TECHNICIAN_HAS_OPEN_JOBS`.
    It closes: the same PUT succeeds — and Ravi becomes a freelancer, which
    every later money row is stamped with."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            ravi = await profile(db, w, "ravi")
            # Re-run hygiene: an interrupted earlier run left tickets still on
            # Ravi, and the flip below is 409 over an open job — a refusal that
            # is the PRODUCT behaving right. Close the leftovers first, and
            # settle anything he was never paid out, because R5 refuses the
            # flip over unredeemed money with the same 409.
            await clear_open_jobs(db, w)
            await drain_balance(db, w, "ravi")
            # Whatever a previous run left, #7 needs Ravi employee first. The
            # switch itself is exercised below; no open job now, so both
            # directions are 200.
            if ravi.technician_type != "employee":
                out = await tech_service.update_technician(
                    db, await p(db, "priya"), w.ravi_id,
                    TechnicianUpdateRequest(technicianType="employee"),
                )
                assert out.technicianType == "employee"

            row = await raise_ticket(db, w, ravi, index=1)
            await accept_job(db, w, ravi, row)
            FACTS.t_assign = row.id
            FACTS.tickets = [x for x in FACTS.tickets if x != row.id]
            FACTS.tickets.append(row.id)
            assert row.status == "Assigned"

            with pytest.raises(AppError) as exc:
                await tech_service.update_technician(
                    db, await p(db, "priya"), w.ravi_id,
                    TechnicianUpdateRequest(technicianType="freelancer"),
                )
            assert exc.value.status_code == 409
            assert exc.value.code == "TECHNICIAN_HAS_OPEN_JOBS"

            row = await db.get(Ticket, FACTS.t_assign)
            await customer_close(db, w, row)

            out = await tech_service.update_technician(
                db, await p(db, "priya"), w.ravi_id,
                TechnicianUpdateRequest(technicianType="freelancer"),
            )
            assert out.technicianType == "freelancer"
            # LEFT a freelancer: the money walk (#10/#12) runs after #7 and
            # stamps each ledger row with the type the WRITE read — Ravi's
            # rows are freelancer because #7 just made him one.
    run(_t())


# ── #8. The UPI reviewer ──────────────────────────────────────────────────


def test_08_upi_reviewer_is_the_franchisee_admin_for_ravi():
    """Ravi's change request: reviewed by a franchisee_admin of S, bell rung to
    Priya alone — from both the DB rows and each reader's feed — and the
    account screen saying who is waiting. Priya REJECTS it (the portal's own
    decision), so a re-run can ask again."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            reviewer = await p(db, "priya")
            try:
                out = await tech_service.request_upi_change(
                    db, await p(db, "ravi"),
                    UpiChangeRequestIn(upiId="ravi.new@ybl", upiName="Ravi Kumar"),
                )
            except AppError as exc:
                # An interrupted earlier run can leave one waiting; the
                # PENDING guard is the product refusing a second open ask.
                assert exc.code == "CHANGE_PENDING", exc.code
                await tech_service.reject_upi_change(
                    db, reviewer, w.ravi_id,
                    UpiRejectRequest(reason="Acceptance run — clearing stale."),
                )
                out = await tech_service.request_upi_change(
                    db, await p(db, "ravi"),
                    UpiChangeRequestIn(upiId="ravi.new@ybl", upiName="Ravi Kumar"),
                )
            assert out.change.reviewerLabel == "Franchisee Admin"

            stamp = (await db.execute(
                text("""
                SELECT reviewer_role FROM upi_change_requests
                WHERE technician_id = CAST(:t AS uuid) AND status = 'pending'
                ORDER BY created_at DESC LIMIT 1
                """).bindparams(t=str(w.ravi_id))
            )).first()
            assert stamp is not None
            assert stamp.reviewer_role == "franchisee_admin"

            # The territory walk leaves the franchisee on the BELL row, not on
            # the change request — pincode/franchisee_id live on notifications.
            bell = (await db.execute(
                text("""
                SELECT audience, pincode, franchisee_id FROM notifications
                WHERE "to" = :to_ AND kind = 'upi_change'
                ORDER BY created_at DESC LIMIT 1
                """).bindparams(to_=f"/technicians/{w.ravi_id}")
            )).first()
            assert bell is not None
            assert str(bell.franchisee_id) == str(w.s_id)
            assert bell.pincode is None

            # Priya hears it; Kiran and Nisha do not — each feed as the
            # reader's own query answers it.
            for who, expected in (("priya", True), ("kiran", False), ("nisha", False)):
                actor = await p(db, who)
                rows, _total = await notif_service.list_page(
                    db, actor, page=1, limit=100, kind="upi_change"
                )
                heard = any(n.to == f"/technicians/{w.ravi_id}" for n in rows)
                assert heard is expected, f"{who} heard={heard}, expected {expected}"

            # The portal's queue and its badge.
            feed, _total = await tech_service.list_upi_changes(
                db, await p(db, "priya"), ListParams(), state="pending"
            )
            assert any(str(r.technicianId) == str(w.ravi_id) for r in feed)
            badge = await tech_service.count_pending_upi_changes(
                db, await p(db, "priya")
            )
            assert badge.pending == 1

            # Deciding it is HER money line to judge. The UPI stays as it was.
            await tech_service.reject_upi_change(
                db, await p(db, "priya"), w.ravi_id,
                UpiRejectRequest(reason="Mismatched name on the account"),
            )
            still = await tech_service.get_payout_account(db, await p(db, "ravi"))
            assert still.upiId == "ravit05@ybl"
    run(_t())


def test_08b_upi_reviewer_is_the_area_manager_for_hema():
    """Hema (home) asks: the AM in her state reviews — with her OWN pincode
    naming the territory — and Kiran (that AM) rejects, cleaning the queue."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            try:
                out = await tech_service.request_upi_change(
                    db, await p(db, "hema"),
                    UpiChangeRequestIn(upiId="hema.new@ybl", upiName="Hema Nair"),
                )
            except AppError as exc:
                assert exc.code == "CHANGE_PENDING", exc.code
                await tech_service.reject_upi_change(
                    db, await p(db, "kiran"), w.hema_id,
                    UpiRejectRequest(reason="Acceptance run — clearing stale."),
                )
                out = await tech_service.request_upi_change(
                    db, await p(db, "hema"),
                    UpiChangeRequestIn(upiId="hema.new@ybl", upiName="Hema Nair"),
                )
            assert out.change.reviewerLabel == "Area Manager"

            stamp = (await db.execute(
                text("""
                SELECT reviewer_role FROM upi_change_requests
                WHERE technician_id = CAST(:t AS uuid) AND status = 'pending'
                ORDER BY created_at DESC LIMIT 1
                """).bindparams(t=str(w.hema_id))
            )).first()
            assert stamp is not None
            assert stamp.reviewer_role == "area_manager"

            # The AM is pinpointed by the BELL row's pincode — the change
            # request itself does not carry territory here.
            bell = (await db.execute(
                text("""
                SELECT audience, pincode, franchisee_id FROM notifications
                WHERE "to" = :to_ AND kind = 'upi_change'
                ORDER BY created_at DESC LIMIT 1
                """).bindparams(to_=f"/technicians/{w.hema_id}")
            )).first()
            assert bell is not None
            assert bell.audience == "area_manager"
            assert bell.pincode in w.hema_pincodes
            # The home chain still carries the HOME's id as its third element
            # (the walk's contract) — it just doesn't NARROW the bell: the
            # pincode does, so every AM of the company is not rung at once.
            assert str(bell.franchisee_id) == str(w.home_id)

            await tech_service.reject_upi_change(
                db, await p(db, "kiran"), w.hema_id,
                UpiRejectRequest(reason="Acceptance run — keeping the UPI as is."),
            )
    run(_t())


# ── #9. The web-push mirror ───────────────────────────────────────────────


def _cast():
    w = world()
    return (
        ("priya", w.priya_email, w.company_a_id),
        ("hari", w.hari_email, w.company_a_id),
        ("kiran", w.kiran_email, w.company_a_id),
        ("nisha", w.nisha_email, w.company_a_id),
        ("uma", w.uma_email, w.company_a_id),
        ("bala", w.bala_email, w.company_b_id),
    )


def test_09_users_notified_by_agrees_with_the_feeds():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            ids = {
                key: (await seed_task05.principal_by_email(db, email, cid)).user_id
                for key, email, cid in _cast()
            }

            # Ravi's bell: addressed to S's admins — Priya and nobody else.
            got = await users_notified_by(
                db, company_id=w.company_a_id, pincode=None,
                audience="franchisee_admin", franchisee_id=w.s_id,
            )
            assert ids["priya"] in got
            for k in ("kiran", "nisha", "uma"):
                assert ids[k] not in got, f"{k} heard S's bell"

            # Home's payers' bell: the company payer — plus the home's own
            # admins (F8) — never another franchisee's admin.
            got_home = await users_notified_by(
                db, company_id=w.company_a_id, pincode=None,
                audience="payers", franchisee_id=w.home_id,
            )
            assert ids["nisha"] in got_home
            assert ids["hari"] in got_home
            assert ids["kiran"] not in got_home
    run(_t())


# ── #10. The money scenario, driven by real hands ─────────────────────────


def test_10_money_scenario_and_ledger_stamps():
    """Seven tickets a real week leaves behind. Every ledger row this walk
    writes carries the FRANCHISEE stamp the pool is per (F12) and the
    technician_type AS OF THE WRITE: t_assign is raised, closed and paid
    inside #7 while Ravi is still an employee — its payout says employee,
    because the flip came after the close (the guard refuses a flip over an
    open job). The walk's own Ravi rows come after #7's switch → freelancer;
    Hema's → employee. Never crossed, never the home's for S."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            ravi = await profile(db, w, "ravi")
            # Leftover open jobs (an interrupted run) would block the walk's
            # own accepts AND flood the offered reschedule windows — clear
            # them the honest way before anything is raised.
            await clear_open_jobs(db, w)
            # The walk is a week of work in one slot-date: every Closed job
            # counts toward the cap, leftovers from an earlier run included,
            # and the refusal at five is the PRODUCT behaving right. The cap
            # comes off the way a real technician does it — Profile →
            # Availability & bandwidth, "no limit".
            await tech_service.update_technician(
                db, await p(db, "priya"), w.ravi_id,
                TechnicianUpdateRequest(dailyJobCap=None),
            )
            await db.refresh(ravi)
            await raise_penalty_ceiling(db, w)

            # (a) the technician cancels an accepted job → penalty
            row = await raise_ticket(db, w, ravi, index=2)
            await accept_job(db, w, ravi, row)
            await jobs_service.cancel(
                db, row.id, company_id=w.company_a_id, profile=ravi,
                reason="Vehicle breakdown on the way",
            )
            await db.refresh(row)
            FACTS.t_cancel = row.id
            FACTS.tickets.append(row.id)

            # (b) a confirmed no-show — the past is unreachable through the
            # services by design, so the fixture moves the clock the way
            # `seed/backdate.py` does (slot times AND the assigned event).
            row = await raise_ticket(db, w, ravi, index=3)
            await accept_job(db, w, ravi, row)
            past = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(
                update(Ticket)
                .where(Ticket.id == row.id)
                .values(
                    slot_start=past - datetime.timedelta(hours=6),
                    slot_end=past - datetime.timedelta(hours=5),
                )
            )
            await db.execute(
                update(TicketEvent)
                .where(TicketEvent.ticket_id == row.id, TicketEvent.kind == "assigned")
                .values(created_at=past - datetime.timedelta(hours=6, minutes=30))
            )
            await db.commit()
            await tickets_service.record_no_show(
                db, await p(db, "kiran"), row.id,
                note="Nobody came; the customer called at 09:40.",
            )
            await db.refresh(row)
            assert row.status == "Escalated" and row.technician_id is None
            FACTS.t_noshow = row.id
            FACTS.tickets.append(row.id)

            # (c) a bonused job — the sweep's FIRST arm escalates a job whose
            # slot is close (under four hours) with nobody on it, and the
            # manager funds the bonus on that escalation screen. The bonus
            # refuses both a ticket that is not Escalated (nobody accepted)
            # and one whose slot has already started, so the slot is nudged
            # near — started enough to be at risk, not started.
            row = await raise_ticket(db, w, ravi, index=4)
            soon = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(
                update(Ticket)
                .where(Ticket.id == row.id)
                .values(
                    slot_start=soon + datetime.timedelta(hours=1),
                    slot_end=soon + datetime.timedelta(hours=2),
                )
            )
            await db.commit()
            await sweep_unaccepted(db)
            await db.refresh(row)
            assert row.status == "Escalated" and row.technician_id is None
            await tickets_service.add_bonus_and_renotify(
                db, await p(db, "kiran"), row.id, amount_paise=BONUS_PAISE
            )
            await db.refresh(row)
            await accept_job(db, w, ravi, row)
            await customer_close(db, w, row)
            FACTS.t_bonus = row.id
            FACTS.tickets.append(row.id)

            # (d) the customer closes a plain job
            row = await raise_ticket(db, w, ravi, index=5)
            await accept_job(db, w, ravi, row)
            await customer_close(db, w, row)
            FACTS.t_close = row.id
            FACTS.tickets.append(row.id)

            # (e) the manager force-closes
            row = await raise_ticket(db, w, ravi, index=6)
            await accept_job(db, w, ravi, row)
            await tickets_service.force_close_ticket(
                db, await p(db, "kiran"), row.id,
                ForceCloseRequest(
                    reason="Customer unreachable after the visit",
                    notes="Acceptance run: work completed, customer never confirmed.",
                    attachments=[
                        ForceCloseAttachmentIn(
                            blobName=f"attachment/{w.company_a_id}/acceptance/{row.id}/call-log.png"
                        )
                    ],
                    technicianPayoutPaise=30_000,
                ),
            )
            await db.refresh(row)
            FACTS.t_force = row.id
            FACTS.tickets.append(row.id)

            # (f) HEMA, at home: one penalty…
            hema = await profile(db, w, "hema")
            # Same room for Hema: her leftovers count too, and a week is more
            # than five slots for anyone.
            await tech_service.update_technician(
                db, await p(db, "admin"), w.hema_id,
                TechnicianUpdateRequest(dailyJobCap=None),
            )
            # And the same flip Ravi got, for the same reason: T2 (Task 06)
            # pays employees by salary and writes no per-job payout — and T4's
            # redemption money cannot exist for somebody nothing is owed to.
            # #14 still needs HOME's money redeemed by the company payer, so
            # the earning home technician is a freelancer AT home. The stamps
            # below hold the same truth either way: the type AS OF THE WRITE.
            await tech_service.update_technician(
                db, await p(db, "admin"), w.hema_id,
                TechnicianUpdateRequest(technicianType="freelancer"),
            )
            await db.refresh(hema)
            await db.refresh(hema)
            hrow = await raise_ticket(db, w, hema, index=8)
            await accept_job(db, w, hema, hrow)
            await jobs_service.cancel(
                db, hrow.id, company_id=w.company_a_id, profile=hema,
                reason="Double booked for this window",
            )
            await db.refresh(hrow)
            FACTS.t_hema = hrow.id
            FACTS.tickets.append(hrow.id)

            # …and one job the customer closed — the payout #14 pays from.
            hema = await profile(db, w, "hema")
            hrow = await raise_ticket(db, w, hema, index=9)
            await accept_job(db, w, hema, hrow)
            await customer_close(db, w, hrow)
            FACTS.t_hema_paid = hrow.id
            FACTS.tickets.append(hrow.id)

            # ── §7 #10: the stamps, per ticket ──
            # What the WRITE read, per ticket: t_assign lives inside #7 —
            # raised, accepted and Closed while Ravi was still an employee,
            # with the type flip coming after precisely because the guard
            # refuses a flip over an open job. T2 (Task 06) pays employees by
            # salary, so its customer-closure writes NO payout row — "the
            # ledger's silence IS the fact" — which is why t_assign alone may
            # carry no rows; any row it does carry must still carry the right
            # stamp (T1 kept a legacy payout path honest under the same rule).
            # The walk's own tickets come after the switch: freelancer, both
            # for Ravi in the S pool and for Hema after her flip. The money
            # row cannot retroactively become what the technician was later.
            expected_type = {
                FACTS.t_hema: ("home", "freelancer"),
                FACTS.t_hema_paid: ("home", "freelancer"),
                FACTS.t_assign: ("s", "employee"),
            }
            assert FACTS.t_assign is not None
            for tid in FACTS.tickets:
                if tid is None:
                    continue
                pool, want = expected_type.get(tid, ("s", "freelancer"))
                want_id = w.s_id if pool == "s" else w.home_id
                own = (
                    await db.execute(
                        select(
                            LedgerEntry.kind,
                            LedgerEntry.franchisee_id,
                            LedgerEntry.technician_type,
                        ).where(
                            LedgerEntry.company_id == w.company_a_id,
                            LedgerEntry.ticket_id == tid,
                        )
                    )
                ).all()
                if not own and tid == FACTS.t_assign:
                    continue  # T2's salary silence — there is no row to read
                assert own, f"no ledger movement on ticket {tid}"
                for kind, fid, ttype in own:
                    assert str(fid) == str(want_id), f"{kind} stamped {fid}"
                    assert ttype == want, f"{kind} type {ttype}"

            # Penalty ids in hand, for #12 — by ticket, so a re-run's older
            # rows never confuse this run's facts.
            ravi_penalties = list(
                await db.scalars(
                    select(LedgerEntry)
                    .where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.kind == "penalty",
                        LedgerEntry.reverses_id.is_(None),
                        LedgerEntry.ticket_id.in_([FACTS.t_cancel, FACTS.t_noshow]),
                    )
                )
            )
            assert len(ravi_penalties) >= 2
            by_ticket = {str(r.ticket_id): r for r in ravi_penalties}
            FACTS.ravi_penalty = by_ticket[str(FACTS.t_cancel)].id
            FACTS.ravi_penalty2 = by_ticket[str(FACTS.t_noshow)].id
            # A bare id — `db.scalar`, not a Row: #12 feeds it straight to a
            # caller that wants a UUID.
            FACTS.hema_penalty = await db.scalar(
                select(LedgerEntry.id)
                .where(
                    LedgerEntry.company_id == w.company_a_id,
                    LedgerEntry.kind == "penalty",
                    LedgerEntry.technician_id == w.hema_id,
                    LedgerEntry.reverses_id.is_(None),
                    LedgerEntry.ticket_id == FACTS.t_hema,
                )
                .limit(1)
            )
            assert FACTS.hema_penalty is not None
    run(_t())


# ── #11. One pool per franchisee ──────────────────────────────────────────


def test_11_pool_agrees_with_the_rows():
    """The core arithmetic, the service read, and every reader's scoping
    answer agree with the rows themselves — and a foreign id is nobody's."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            totals_rows = (
                await db.execute(
                    text("""
                    SELECT kind, sum(amount_paise), count(*)
                    FROM ledger_entries
                    WHERE company_id = CAST(:c AS uuid)
                      AND franchisee_id = CAST(:f AS uuid)
                    GROUP BY kind
                    """).bindparams(c=str(w.company_a_id), f=str(w.s_id))
                )
            ).all()
            totals = {k: (int(a), int(n)) for k, a, n in totals_rows}

            via_core = await core_pool(
                db, company_id=w.company_a_id, franchisee_id=w.s_id
            )
            assert via_core == pool_arithmetic(totals)

            out = await ledger_service.get_pool(
                db, company_id=w.company_a_id, franchisee_id=w.s_id
            )
            assert str(out.franchiseeId) == str(w.s_id)
            assert out.balancePaise == via_core["balancePaise"]
            assert out.penaltiesCollectedPaise == via_core["penaltiesCollectedPaise"]
            assert out.bonusesPaidPaise == via_core["bonusesPaidPaise"]

            # The staff door's own resolver: Kiran naming S reads S's pool.
            home_id, known = await money_context(db, w.company_a_id)
            assert w.s_id in known
            assert pool_franchisee(
                is_franchise=False, own=None, requested=w.s_id,
                home_id=home_id, known=known,
            ) == w.s_id
            scoped = await ledger_router._scoped(db, await p(db, "kiran"), w.s_id)
            assert scoped == w.s_id

            # A company-B id, asked from company A's side of the wall, is an
            # unknown pool: 404, not somebody else's numbers.
            foreign_home, foreign_known = await money_context(db, w.company_b_id)
            assert w.s_id not in foreign_known
            with pytest.raises(AppError) as exc:
                await ledger_router._scoped(
                    db, await p(db, "kiran"), w.company_b_id
                )
            assert exc.value.status_code == 404
    run(_t())


def test_11b_kiran_balance_200_entries_403():
    """Kiran's two grants are not the same disclosure: the balance door is
    `jobs.assign` (his role holds it), the entries stay on `earnings.view`
    (it does not) — the exact guards the ledger routes are built on."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            kiran = await p(db, "kiran")
            out = await ledger_service.get_pool(
                db, company_id=w.company_a_id, franchisee_id=w.s_id
            )
            assert str(out.franchiseeId) == str(w.s_id)

            # The router's own guards, called with a db as the route would.
            can_see = require_any_feature("earnings.view", "jobs.assign")
            assert await can_see(kiran, db) is kiran
            with pytest.raises(HTTPException) as exc:
                await require_feature("earnings.view")(kiran, db)
            assert exc.value.status_code == 403
            assert "earnings.view" in exc.value.detail
    run(_t())


# ── #12. Reversal: two doors, one body ────────────────────────────────────


def test_12_reversal_doors():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            # Kiran's ticket page omits Ravi's penalty entirely.
            detail = await tickets_service.get_ticket(
                db, await p(db, "kiran"), FACTS.t_cancel
            )
            assert detail.penalties == []

            # Door 1 refuses him even holding the id in hand: 404, not 403.
            with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                await tickets_service.reverse_penalty(
                    db, await p(db, "kiran"), FACTS.t_cancel,
                    uuid.UUID(str(FACTS.ravi_penalty)),
                    reason="Not his to reverse",
                )
            assert _404(exc)

            # Door 2: Priya gives HER OWN pool's penalty back.
            reversal = await ledger_service.reverse_entry(
                db, await p(db, "priya"),
                uuid.UUID(str(FACTS.ravi_penalty)), "Booked twice by mistake",
            )
            assert reversal.kind == "reversal"
            stamp = (
                await db.execute(
                    select(
                        LedgerEntry.kind,
                        LedgerEntry.franchisee_id,
                        LedgerEntry.technician_type,
                    ).where(LedgerEntry.reverses_id == FACTS.ravi_penalty)
                )
            ).first()
            assert stamp is not None
            assert stamp.kind == "reversal"
            assert str(stamp.franchisee_id) == str(w.s_id)
            # The PENALTY's stamp is copied, not re-derived.
            assert stamp.technician_type == "freelancer"

            ev = (await db.execute(
                text("""
                SELECT id FROM ticket_events
                WHERE ticket_id = CAST(:t AS uuid) AND kind = 'penalty_reversed'
                """).bindparams(t=str(FACTS.t_cancel))
            )).first()
            assert ev is not None  # the trail line, and (Expo) a push to Ravi

            # Once, ever: a repeat is 409 `PENALTY_ALREADY_REVERSED`.
            with pytest.raises(AppError) as exc:
                await ledger_service.reverse_entry(
                    db, await p(db, "priya"), uuid.UUID(str(FACTS.ravi_penalty)),
                    "Trying twice",
                )
            assert exc.value.code == "PENALTY_ALREADY_REVERSED"

            # Nisha through Door 1, on the no-show penalty: the company's
            # officer giving the franchisee's money back.
            await tickets_service.reverse_penalty(
                db, await p(db, "nisha"), FACTS.t_noshow,
                uuid.UUID(str(FACTS.ravi_penalty2)),
                reason="Verified the visit did happen",
            )
            stamp2 = (
                await db.execute(
                    select(LedgerEntry.kind).where(
                        LedgerEntry.reverses_id == FACTS.ravi_penalty2
                    )
                )
            ).scalar_one_or_none()
            assert stamp2 == "reversal"

            # Priya on HOME's money: the wall again — 404. The step needs
            # SOME home-pool penalty, not a particular one — if this run's
            # walk (f) honestly charged ₹0 (month cap spent elsewhere), any
            # unreversed home row still proves the wall.
            hema_penalty = FACTS.hema_penalty or (
                await db.scalar(
                    select(LedgerEntry.id)
                    .where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.kind == "penalty",
                        LedgerEntry.franchisee_id == w.home_id,
                        LedgerEntry.reverses_id.is_(None),
                    )
                    .order_by(LedgerEntry.created_at.desc())
                )
            )
            assert hema_penalty is not None
            with pytest.raises(_NOT_FOUND_ERRORS) as exc:
                await ledger_service.reverse_entry(
                    db, await p(db, "priya"), uuid.UUID(str(hema_penalty)),
                    "Not her pool",
                )
            assert _404(exc)
    run(_t())


# ── #13. The redemption payer ─────────────────────────────────────────────


def test_13_redemption_payer_is_the_franchisee():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            ravi = await profile(db, w, "ravi")
            await clear_open_redemptions(db, w, ravi, "ravi")
            # Re-run hygiene: residue from crashed runs can leave `reserved`
            # ahead of `credited`; the bonus door earns the gap back.
            await top_up_earnings(db, w, "ravi")
            available = await core_ledger_balance(
                db, company_id=w.company_a_id, technician_id=w.ravi_id
            )
            amount = red_service.redeemable(available)
            assert amount > 0, f"Ravi earned nothing redeemable: {available}"

            # GET /redemptions/me, before asking: it says who will pay him.
            card = await red_service.summary(db, ravi)
            assert card.payerLabel == "Franchisee Admin"

            out = await red_service.request(
                db, await p(db, "ravi"), ravi, RedeemRequest(amountPaise=amount)
            )
            rid = out.id

            stamp = (await db.execute(
                text("SELECT franchisee_id FROM redemptions WHERE id = CAST(:r AS uuid)")
                .bindparams(r=str(rid))
            )).first()
            assert stamp is not None
            assert str(stamp.franchisee_id) == str(w.s_id)

            bell = (await db.execute(
                text("""
                SELECT audience, franchisee_id, pincode FROM notifications
                WHERE kind = 'redemption' AND "to" = :to
                ORDER BY created_at DESC LIMIT 1
                """).bindparams(to=f"/redemptions/{rid}")
            )).first()
            assert bell is not None
            assert bell.audience == "franchisee_admin"
            assert str(bell.franchisee_id) == str(w.s_id)
            assert bell.pincode is None

            # The company payer READS it (named) and may not ACT on it.
            staff_view = await red_service.staff_detail(
                db, await p(db, "nisha"), rid, franchisee_id=w.s_id
            )
            assert staff_view.canAct is False
            with pytest.raises(AppError) as exc:
                await red_service.claim(
                    db, await p(db, "nisha"), rid,
                    ClaimRequest(proof=_proof(w.company_a_id, rid),
                                 utr="T05UTR0000001"),
                )
            assert exc.value.status_code == 404

            # The badge before the claim: exactly one to pay in S's pool.
            assert await red_service.count_to_pay(db, await p(db, "priya")) == 1

            # Priya pays Ravi, through the franchise twin's write door.
            claimed = await red_service.claim(
                db, await p(db, "priya"), rid,
                ClaimRequest(proof=_proof(w.company_a_id, rid), utr="T05UTR0000002"),
            )
            assert claimed.state == "awaiting"

            settled = await red_service.confirm(
                db, await p(db, "ravi"), ravi, rid, received=True
            )
            assert settled.state == "settled"
    run(_t())


# ── #14. Home alongside ───────────────────────────────────────────────────


def test_14_home_redemption_paid_by_the_company():
    """HOME's redemption is the COMPANY payer's money: the bell goes to
    `payers`, not to a franchisee admin, and Hari (HOME's own admin) pays it —
    the home pool is the company's own, so its money is redeemed by the
    company, beside every other franchisee's (R3). Hema earns the money the
    walk (#10g) pays her as a freelancer AT home — T2 leaves an employee
    nothing per-job to redeem."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            hema = await profile(db, w, "hema")
            await clear_open_redemptions(db, w, hema, "hema")
            # Same residue repair as #13, funded from HOME's pool by Hari.
            await top_up_earnings(db, w, "hema")
            available = await core_ledger_balance(
                db, company_id=w.company_a_id, technician_id=w.hema_id
            )
            amount = red_service.redeemable(available)
            assert amount > 0, f"Hema earned nothing redeemable: {available}"

            card = await red_service.summary(db, hema)
            assert card.payerLabel != "Franchisee Admin"  # home's payer

            out = await red_service.request(
                db, await p(db, "hema"), hema, RedeemRequest(amountPaise=amount)
            )
            rid = out.id

            bell = (await db.execute(
                text("""
                SELECT audience, franchisee_id FROM notifications
                WHERE kind = 'redemption' AND "to" = :to
                ORDER BY created_at DESC LIMIT 1
                """).bindparams(to=f"/redemptions/{rid}")
            )).first()
            assert bell is not None
            assert bell.audience == "payers"
            assert str(bell.franchisee_id) == str(w.home_id)

            # Nisha and Hari both see it; Kiran does not.
            for who, expected in (("nisha", True), ("hari", True), ("kiran", False)):
                actor = await p(db, who)
                rows, _total = await notif_service.list_page(
                    db, actor, page=1, limit=100, kind="redemption"
                )
                heard = any(n.to == f"/redemptions/{rid}" for n in rows)
                assert heard is expected, f"{who} heard={heard}"

            # Hari — HOME's own admin — pays it through the franchise door.
            claimed = await red_service.claim(
                db, await p(db, "hari"), rid,
                ClaimRequest(proof=_proof(w.company_a_id, rid)),
            )
            assert claimed.state == "awaiting"

            settled = await red_service.confirm(
                db, await p(db, "hema"), hema, rid, received=True
            )
            assert settled.state == "settled"
    run(_t())


# ── #15. Options and pincodes ─────────────────────────────────────────────


def test_15_options_and_pincodes():
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            opts = await portal_service.technician_options(
                db, company_id=w.company_a_id, franchisee_id=w.s_id
            )
            regions = [r["name"] for r in opts["regions"]]
            assert regions == ["South"], regions
            assert any(
                str(n["id"]) == str(w.leaf_id) for n in opts["subcategories"]
            )

            codes, _total = await portal_service.pincodes(
                db, company_id=w.company_a_id, franchisee_id=w.s_id,
                params=ListParams(), search=w.s_pincodes[0][:4], region_id=None,
            )
            assert {c["code"] for c in codes} == set(w.s_pincodes)
    run(_t())


# ── #16. Tickets untouched ────────────────────────────────────────────────


def test_16_tickets_untouched_for_staff():
    """Kiran reschedules, assigns and force-closes one of Ravi's tickets in
    his territory — Task 05 changed WHO owns the money and the roster, never
    the job itself."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            ravi = await profile(db, w, "ravi")
            # Re-run hygiene: windows Ravi already holds are taken OFF the
            # offered list — a leftover open job from an interrupted run would
            # empty the reschedule options entirely.
            await clear_open_jobs(db, w)
            row = await raise_ticket(db, w, ravi, index=10)
            await tickets_service.assign_technician(
                db, await p(db, "kiran"), row.id, technician_id=w.ravi_id
            )
            await db.refresh(row)
            assert row.status == "Assigned"

            options = await tickets_service.reschedule_options(
                db, await p(db, "kiran"), row.id
            )
            assert options
            new_start = options[0].slotStart
            await tickets_service.reschedule(
                db, await p(db, "kiran"), row.id,
                slot_start=new_start, reason="The customer asked for a later day.",
            )
            await db.refresh(row)
            assert row.slot_start == new_start

            await tickets_service.force_close_ticket(
                db, await p(db, "kiran"), row.id,
                ForceCloseRequest(
                    reason="Customer did not respond to the confirmation link",
                    notes="Acceptance run end: job closed by the manager.",
                    attachments=[
                        ForceCloseAttachmentIn(
                            blobName=f"attachment/{w.company_a_id}/acceptance/{row.id}/note.png"
                        )
                    ],
                    technicianPayoutPaise=20_000,
                ),
            )
            await db.refresh(row)
    run(_t())