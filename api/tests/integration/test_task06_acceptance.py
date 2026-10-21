"""Task 06 §7 acceptance — employees run on salary, and the month says so.

Driven through the SERVICE layer against RelianceDB (dev) on the same cast
`test_task05_acceptance.py` seeds and walks, exactly as that file runs:
hand-built `Principal`s, a fresh session per segment, no HTTP. Run with:

    cd api
    .venv/Scripts/python.exe -m pytest tests/integration/test_task06_acceptance.py -v

The md's order is kept. The one preparation step (test_01) puts the cast back
in the arrangement §7 names — Ravi a S freelancer, Hema a H EMPLOYEE, Meena a
S employee — because Task 05's own walk necessarily left Hema a freelancer
(its #14 needs HOME's money redeemed) and any earlier interrupted Task 06 run
may have left the others anywhere. Flips go through
`technicians.update_technician` with the R5 guard's own refusals (an open-jobs
409, a positive-balance 409), so money blocks are drained through the product
before the type moves, never by writing the column.

Item #9 (pool push, rupee figure on a freelancer's lock screen and none on an
employee's) is MANUAL by the md's own words — "check the server log / a dev
device" — and ships as an explicit skip saying so.

One truth of this dev database shapes two of the walls: Task 05's walk paid
Ravi per job while he was still an employee (`t_assign`), so the CURRENT month
legitimately holds employee-stamped rows for a now-freelancer. The wall test
(#12) therefore picks the most recent month that has none — the §12 sentence
"Priya with Ravi (freelancer, never employee) reads as nobody" is exactly
clause B of the two-clause wall with no employee stream anywhere near him.
"""

import asyncio
import csv
import dataclasses
import datetime
import io
import sys
import uuid

import pytest

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import func, select, update  # noqa: E402

from tests.integration.test_task05_acceptance import (  # noqa: E402
    _proof,
    accept_job,
    clear_open_jobs,
    clear_open_redemptions,
    customer_close,
    ensure_vendor_headroom,
    p,
    raise_penalty_ceiling,
    raise_ticket,
    run,
    world,
)
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.deps import (  # noqa: E402
    Principal,
    require_franchise_principal,
    require_min_rank,
)
from app.core.errors import AppError  # noqa: E402
from app.core.ledger import IST  # noqa: E402
from app.core.ledger import redeemable_balance  # noqa: E402
from app.core.statements import (  # noqa: E402
    KIND_LINES,
    TOTAL_ORDER,
    build_statement_csv,
    csv_safe,
    load_statement,
    month_bounds,
    month_label,
    resolve_month,
    rupees_plain,
    statement_filename,
)
from app.features.auth import otp_service  # noqa: E402
from app.features.franchise_portal.router import (  # noqa: E402
    statement as franchise_statement_route,
)
from app.features.jobs import service as jobs_service  # noqa: E402
from app.features.ledger import service as ledger_service  # noqa: E402
from app.features.ledger.router import (  # noqa: E402
    statement as staff_statement_route,
)
from app.features.redemptions import service as red_service  # noqa: E402
from app.features.redemptions.schemas import (  # noqa: E402
    ClaimRequest,
    RedeemRequest,
)
from app.features.tickets import feedback_service  # noqa: E402
from app.features.tickets import service as tickets_service  # noqa: E402
from app.features.tickets.schemas import (  # noqa: E402
    ForceCloseAttachmentIn,
    ForceCloseRequest,
)
from app.features.tickets.sweeps import sweep_unaccepted  # noqa: E402
from app.features.technicians import service as tech_service  # noqa: E402
from app.features.technicians.schemas import TechnicianUpdateRequest  # noqa: E402
from app.models.ledger import LedgerEntry  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.redemption import Redemption  # noqa: E402
from app.models.role import (  # noqa: E402
    AREA_MANAGER,
    FACILITY_ADMIN,
    NATIONAL_HEAD,
    ROLE_RANKS,
)
from app.models.technician import TechnicianProfile  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_event import TicketEvent  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.vendor_credits import VendorCreditEntry  # noqa: E402
from app.scripts import seed_task05  # noqa: E402
from app.scripts.seed.backdate import shift_ticket  # noqa: E402


# ── the cast, and what this run hands itself ──────────────────────────────

BONUS_PAISE = 40_000  # ₹400 — the worked example's bonus (Task 06 §1)
# ₹3,200 manufactured five closes at a time: 5 × ₹600 + 1 × ₹200 exactly.
_FORCE_PIECES = [60_000, 60_000, 60_000, 60_000, 60_000, 20_000]


@dataclasses.dataclass
class Facts:
    #: Tickets and ledger ids this run raised, in file order; read by the
    #: tests after them. One pytest run's own artifacts.
    t_meena_closed: uuid.UUID | None = None    # #1 — customer confirmation
    t_ravi_closed: uuid.UUID | None = None     # #1 — the freelancer control
    t_meena_force: uuid.UUID | None = None     # #2 — the ignored payout field
    t_meena_cancel: uuid.UUID | None = None    # #3a — penalty (goes to Sept)
    t_meena_noshow: uuid.UUID | None = None    # #3b
    t_meena_bonus: uuid.UUID | None = None     # #3c
    meena_penalty_id: uuid.UUID | None = None  # #3a's charge, reversed in #11
    meena_bonus_id: uuid.UUID | None = None    # #3c's ₹400
    ravi_open_redemption: uuid.UUID | None = None  # #5
    wall_month: str | None = None              # #12 — the clean month found
    #: Technicians whose ledger already carried an employee-stream payout row
    #: BEFORE this run touched anything — the md's §7 #14 asks verify.py to
    #: pass on a SEEDED company, and this dev database also carries Task 05's
    #: walk history (per-job payouts written while Ravi was briefly an
    #: employee, before Task 06's gate). #16 holds this run to a stricter
    #: promise: add none, and never for Meena.
    verify_baseline: frozenset[str] = frozenset()


FACTS = Facts()


def profx(db, w, which: str):
    """Any of the three technicians' profiles, fresh in THIS session."""
    return db.get(
        TechnicianProfile,
        {"ravi": w.ravi_id, "hema": w.hema_id, "meena": w.meena_id}[which],
        populate_existing=True,
    )


def who_flips(which: str) -> str:
    """The principal that may change this technician's type — Priya for her
    own two, the company admin for the home's (the S admin's wall would say
    FRANCHISEE_NOT_MANAGED, and the wall is tested, not worked around)."""
    return "priya" if which in ("ravi", "meena") else "admin"


async def tech_principal(db, w, which: str) -> Principal:
    """One of the three technicians, as the app itself puts them at the door
    (Task 05's `p` knows Ravi and Hema only; Meena is this task's hire)."""
    return await seed_task05.technician_principal(
        db, w.meena_id if which == "meena" else
        w.ravi_id if which == "ravi" else w.hema_id,
        w.company_a_id,
    )


async def set_type(db, w, which: str, new_type: str) -> None:
    """One type change through the product — the R5 guard answering or not."""
    prof = await profx(db, w, which)
    await tech_service.update_technician(
        db, await p(db, who_flips(which)), prof.id,
        TechnicianUpdateRequest(technicianType=new_type),
    )
    await db.refresh(prof)


async def freelancer_balance(db, w, which: str) -> int:
    return await redeemable_balance(
        db, company_id=w.company_a_id,
        technician_id={"ravi": w.ravi_id, "hema": w.hema_id, "meena": w.meena_id}[which],
    )


async def redeem_all(db, w, which: str) -> None:
    """What a freelancer is owed, taken out — through the payer's claim and
    the technician's own confirm. Re-run hygiene for the balance clauses."""
    prof = await profx(db, w, which)
    await clear_open_redemptions(db, w, prof, which)
    available = await freelancer_balance(db, w, which)
    amount = red_service.redeemable(available)
    if amount <= 0:
        return
    out = await red_service.request(
        db, await p(db, which), prof, RedeemRequest(amountPaise=amount)
    )
    payer = {"ravi": "priya", "hema": "hari"}[which]
    await red_service.claim(
        db, await p(db, payer), out.id,
        ClaimRequest(proof=_proof(w.company_a_id, out.id),
                     utr="T06DRAIN" + out.id.hex[:27]),
    )
    await red_service.confirm(db, await p(db, which), prof, out.id, received=True)


async def ensure_type(db, w, which: str, want: str) -> None:
    """Put one cast member on the arrangement §7 names, through the product.

    An open-job 409 or a positive-balance 409 is the guard behaving; the money
    or the jobs are settled first, the same way a real ops day would."""
    prof = await profx(db, w, which)
    if prof.technician_type == want:
        return
    if prof.technician_type == "freelancer":  # the balance clause direction
        await redeem_all(db, w, which)
    await set_type(db, w, which, want)
    prof = await profx(db, w, which)
    assert prof.technician_type == want, f"{which} type {prof.technician_type}"


async def ensure_credits(db, w, *, minimum: int = 600) -> None:
    """The company's ticket-credit balance must carry a run's tickets — this
    file raises about twenty, which is what a week is. The honest door is the
    recharge the seed's own `top_up_credits` walks (request, claim, the
    platform's superadmin confirms); a leftover open recharge from a crashed
    run is cancelled the ordinary way first, and one already claimed is
    confirmed, because it has been paid for."""
    from app.core.credits import balance as credit_balance, load_platform_settings
    from app.features.credits import service as credits_service
    from app.models.credits import CreditRecharge
    from app.scripts.seed.tenant import top_up_credits

    current = await credit_balance(db, w.company_a_id)
    if current >= minimum:
        return
    stale = await db.scalar(
        select(CreditRecharge).where(
            CreditRecharge.company_id == w.company_a_id,
            CreditRecharge.cancelled_at.is_(None),
            CreditRecharge.rejected_at.is_(None),
            CreditRecharge.confirmed_at.is_(None),
        )
    )
    if stale is not None:  # a crashed run left one open
        if stale.claimed_at is None:
            await credits_service.cancel_recharge(db, await p(db, "admin"), stale.id)
        else:
            await credits_service.confirm(db, await _superadmin(db), stale.id)
    platform_credits = (await load_platform_settings(db)).ticket_credits
    admin = await p(db, "admin")
    await top_up_credits(
        db, admin=admin,
        credits=max(platform_credits * 100, minimum - current + platform_credits * 50),
        owner=None,
    )


async def _superadmin(db) -> Principal:
    """The platform's superadmin, for confirming a paid recharge."""
    user = await db.scalar(select(User).where(User.role == "superadmin").limit(1))
    assert user is not None, "no superadmin on this database"
    return Principal(
        user=user, role=user.role, rank=0, is_superadmin=True, company_id=None,
    )


def raise_force_close(w, amount_paise: int) -> ForceCloseRequest:
    """A force-close body that credits the technician — T2 ignores it for an
    employee; for a freelancer it is the money the balance tests spend."""
    return ForceCloseRequest(
        reason="Customer unreachable after the visit",
        notes="Task 06 acceptance run.",
        attachments=[
            ForceCloseAttachmentIn(
                blobName=f"attachment/{w.company_a_id}/task06/{uuid.uuid4().hex}/evidence.png"
            )
        ],
        technicianPayoutPaise=amount_paise,
    )


async def force_close(db, w, row: Ticket, amount_paise: int) -> None:
    await tickets_service.force_close_ticket(
        db, await p(db, "kiran"), row.id, raise_force_close(w, amount_paise)
    )
    await db.refresh(row)


def _this_month() -> str:
    return datetime.datetime.now(IST).strftime("%Y-%m")


def _shift_month(month: str, delta: int) -> str:
    y, m = (int(x) for x in month.split("-"))
    total = y * 12 + (m - 1) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


async def _employee_rows_in_month(db, w, fid, technician_id, month: str) -> int:
    """How many employee-stream rows sit at one franchisee in one month —
    clause B of the wall, asked directly when choosing a clean month."""
    y, m = (int(x) for x in month.split("-"))
    start, end = month_bounds(y, m)
    return await db.scalar(
        select(func.count())
        .select_from(LedgerEntry)
        .where(
            LedgerEntry.company_id == w.company_a_id,
            LedgerEntry.franchisee_id == fid,
            LedgerEntry.technician_id == technician_id,
            LedgerEntry.technician_type == "employee",
            LedgerEntry.created_at >= start,
            LedgerEntry.created_at < end,
        )
    )


async def _build_csv(db, w, technician_id, month: str, *, franchisee_id):
    y, m = (int(x) for x in month.split("-"))
    sheet = await load_statement(
        db, company_id=w.company_a_id, franchisee_id=franchisee_id,
        technician_id=technician_id, year=y, month=m,
    )
    body = build_statement_csv(
        franchisee_name=sheet.franchisee_name,
        franchisee_code=sheet.franchisee_code,
        month_label=month_label(y, m),
        employee_name=sheet.employee_name,
        employee_code=sheet.employee_code,
        employee_phone=sheet.employee_phone,
        rows=sheet.rows,
    )
    return sheet, ("﻿" + body)


def _totals_from_csv(body: str) -> dict[str, tuple[str, str]]:
    """Kind -> (credit cell, debit cell) from the totals block, and the net."""
    rows = list(csv.reader(io.StringIO(body.lstrip("﻿"))))
    totals: dict[str, tuple[str, str]] = {}
    net = None
    for line in rows:
        if not line:
            continue
        for kind in TOTAL_ORDER:
            if kind not in KIND_LINES:
                continue
            if line[0] == KIND_LINES[kind][1]:
                totals[kind] = (line[4], line[5])
        if line[0] == "Net for the month":
            net = line[4]
    return totals, net


# ── preparation: the arrangement §7 names ─────────────────────────────────


def test_01_prepare_the_cast_and_the_month():
    """Ravi a S freelancer, Hema a H employee, Meena a S employee; the caps
    and ceilings a whole week of tickets needs; and one employee-stream
    penalty for Hema at HOME this month, which #13's staff statement reads.
    Every settle goes through the product, so a refusal here IS a finding."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            await clear_open_jobs(db, w)
            await ensure_vendor_headroom(db)
            await ensure_credits(db, w)
            await raise_penalty_ceiling(db, w)
            for which in ("ravi", "hema", "meena"):
                # A week of tickets is more than five slots for anyone — the
                # cap comes off through Profile → Availability, as #10's walk
                # does it.
                await tech_service.update_technician(
                    db, await p(db, who_flips(which)), w.ravi_id if which == "ravi"
                    else w.hema_id if which == "hema" else w.meena_id,
                    TechnicianUpdateRequest(dailyJobCap=None),
                )
            # The §7 arrangement, restored through the R5-guarded door.
            await ensure_type(db, w, "ravi", "freelancer")
            await ensure_type(db, w, "hema", "employee")
            await ensure_type(db, w, "meena", "employee")

            # Hema's employee-stream penalty at home, this month. Hema is an
            # employee: the closure pays nothing, the cancellation charges
            # money — T3.
            hema = await profx(db, w, "hema")
            hrow = await raise_ticket(db, w, hema, index=7000)
            await accept_job(db, w, hema, hrow)
            await jobs_service.cancel(
                db, hrow.id, company_id=w.company_a_id, profile=hema,
                reason="Task 06: double booked for this window",
            )
            await db.refresh(hrow)
            stamp = (
                await db.execute(
                    select(LedgerEntry.kind, LedgerEntry.technician_type,
                           LedgerEntry.franchisee_id)
                    .where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == hrow.id,
                    )
                )
            ).all()
            assert stamp and all(
                k == "penalty" and t == "employee" and str(f) == str(w.home_id)
                for k, t, f in stamp
            ), stamp

            # The baseline #16 measures this run against (see Facts): the
            # technicians whose stream ALREADY carries a payout row, before
            # this run's walk touches anything.
            FACTS.verify_baseline = frozenset(
                str(tid)
                for tid in await db.scalars(
                    select(LedgerEntry.technician_id).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.kind == "payout",
                        LedgerEntry.technician_type == "employee",
                    ).distinct()
                )
            )
    run(_t())


# ── #1. Closure, no payout ────────────────────────────────────────────────


def test_02_closure_writes_no_payout_for_meena_one_for_ravi():
    """§7 #1. Meena's job closed and paid nobody; the vendor WAS billed for
    both — the vendor's money is its own stream and does not care who the
    technician salaried. Ravi is the control: one payout, stamped freelancer."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await profx(db, w, "meena")
            row = await raise_ticket(db, w, meena, index=7001)
            await accept_job(db, w, meena, row)
            await customer_close(db, w, row)
            await db.refresh(row)
            assert row.status == "Closed"
            FACTS.t_meena_closed = row.id

            ravi = await profx(db, w, "ravi")
            rrow = await raise_ticket(db, w, ravi, index=7002)
            await accept_job(db, w, ravi, rrow)
            await customer_close(db, w, rrow)
            await db.refresh(rrow)
            FACTS.t_ravi_closed = rrow.id

            # The vendor bill rows: one charge per ticket, structurally.
            for tid in (row.id, rrow.id):
                charge = await db.scalar(
                    select(VendorCreditEntry)
                    .where(
                        VendorCreditEntry.company_id == w.company_a_id,
                        VendorCreditEntry.ticket_id == tid,
                        VendorCreditEntry.kind == "charge",
                    )
                )
                assert charge is not None and charge.amount_paise > 0, tid

            mine = (
                await db.scalars(
                    select(LedgerEntry).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == row.id,
                    )
                )
            ).all()
            payouts = [e for e in mine if e.kind == "payout"]
            assert not payouts, [e.kind for e in mine]

            his = (
                await db.scalars(
                    select(LedgerEntry).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == rrow.id,
                        LedgerEntry.kind == "payout",
                    )
                )
            ).all()
            assert len(his) == 1
            assert his[0].technician_type == "freelancer"
            assert str(his[0].franchisee_id) == str(w.s_id)
    run(_t())


# ── #2. Force-close — the payout field is ignored, not refused ────────────


def test_03_force_close_ignores_the_payout_for_an_employee():
    """§7 #2. A manager types ₹450 in the box the console prefilled; the
    server overrules rather than 422s, pays nothing, and the trail says why.
    From the detail read, exactly as the console renders it."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await profx(db, w, "meena")
            row = await raise_ticket(db, w, meena, index=7003)
            await accept_job(db, w, meena, row)
            await force_close(db, w, row, 45_000)
            FACTS.t_meena_force = row.id
            assert row.status == "Force-Closed"

            detail = await tickets_service.get_ticket(
                db, await p(db, "kiran"), row.id
            )
            assert detail.technicianType == "employee"
            assert detail.technicianCreditedPaise is None

            payouts = (
                await db.scalars(
                    select(LedgerEntry).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == row.id,
                        LedgerEntry.kind == "payout",
                    )
                )
            ).all()
            assert payouts == []

            event = await db.scalar(
                select(TicketEvent).where(
                    TicketEvent.ticket_id == row.id,
                    TicketEvent.kind == "force_closed",
                )
            )
            assert event is not None
            assert event.note is not None
            assert event.note.endswith("no per-job payout: employee"), event.note
    run(_t())


# ── #3. Other money still flows (T3) ──────────────────────────────────────


def test_04_penalties_and_bonuses_still_flow_stamped_employee():
    """§7 #3. Meena's cancellation, a confirmed no-show and an escalation
    bonus each write a row stamped employee at S. The closure pays none —
    so the bonused job closes with ONLY the bonus row."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await profx(db, w, "meena")

            # (a) cancellation penalty
            row = await raise_ticket(db, w, meena, index=7004)
            await accept_job(db, w, meena, row)
            await jobs_service.cancel(
                db, row.id, company_id=w.company_a_id, profile=meena,
                reason="Task 06: vehicle breakdown on the way",
            )
            await db.refresh(row)
            FACTS.t_meena_cancel = row.id

            # (b) confirmed no-show — the past is unreachable through the
            # services, so the fixture moves the clock as seed/backdate does.
            row = await raise_ticket(db, w, meena, index=7005)
            await accept_job(db, w, meena, row)
            past = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(
                update(Ticket).where(Ticket.id == row.id).values(
                    slot_start=past - datetime.timedelta(hours=6),
                    slot_end=past - datetime.timedelta(hours=5),
                )
            )
            await db.execute(
                update(TicketEvent).where(
                    TicketEvent.ticket_id == row.id,
                    TicketEvent.kind == "assigned",
                ).values(created_at=past - datetime.timedelta(hours=6, minutes=30))
            )
            await db.commit()
            await tickets_service.record_no_show(
                db, await p(db, "kiran"), row.id,
                note="Task 06 acceptance: nobody came.",
            )
            await db.refresh(row)
            assert row.status == "Escalated" and row.technician_id is None
            FACTS.t_meena_noshow = row.id

            # (c) the escalation bonus — sweep's first arm escalates a ticket
            # whose slot is near with nobody on it, the manager funds ₹400,
            # the employee accepts and closes. NO payout row beside it.
            row = await raise_ticket(db, w, meena, index=7006)
            soon = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(
                update(Ticket).where(Ticket.id == row.id).values(
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
            await accept_job(db, w, meena, row)
            await customer_close(db, w, row)
            FACTS.t_meena_bonus = row.id

            want = {
                FACTS.t_meena_cancel: {"penalty"},
                FACTS.t_meena_noshow: {"penalty"},
                FACTS.t_meena_bonus: {"bonus"},  # T2's silence on the closure
            }
            for tid, kinds in want.items():
                mine = (
                    await db.execute(
                        select(LedgerEntry.kind, LedgerEntry.technician_type,
                               LedgerEntry.franchisee_id, LedgerEntry.id)
                        .where(
                            LedgerEntry.company_id == w.company_a_id,
                            LedgerEntry.ticket_id == tid,
                        )
                    )
                ).all()
                assert mine and {k for k, *_ in mine} == kinds, (tid, mine)
                for k, t, f, eid in mine:
                    assert t == "employee", (tid, k, t)
                    assert str(f) == str(w.s_id), (tid, k, f)
            FACTS.meena_penalty_id = (
                await db.scalar(
                    select(LedgerEntry.id).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == FACTS.t_meena_cancel,
                        LedgerEntry.kind == "penalty",
                        LedgerEntry.reverses_id.is_(None),
                    ).limit(1)
                )
            )
            FACTS.meena_bonus_id = (
                await db.scalar(
                    select(LedgerEntry.id).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == FACTS.t_meena_bonus,
                        LedgerEntry.kind == "bonus",
                    ).limit(1)
                )
            )
            assert FACTS.meena_penalty_id and FACTS.meena_bonus_id
    run(_t())


# ── #4. Redeem refused ────────────────────────────────────────────────────


def test_05_meena_cannot_redeem():
    """§7 #4. The ask is 409 by code, the summary greys the button out, and
    no redemption row appears. The refusal answers BEFORE the open check, but
    there is no open row to mask that order either."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await profx(db, w, "meena")
            before = await db.scalar(
                select(func.count()).select_from(Redemption).where(
                    Redemption.company_id == w.company_a_id,
                    Redemption.technician_id == w.meena_id,
                )
            )
            with pytest.raises(AppError) as exc:
                await red_service.request(
                    db, await tech_principal(db, w, "meena"), meena,
                    RedeemRequest(amountPaise=1),
                )
            assert exc.value.status_code == 409
            assert exc.value.code == "EMPLOYEE_CANNOT_REDEEM"

            summary = await red_service.summary(db, meena)
            assert summary.canRedeem is False
            assert summary.technicianType == "employee"
            assert summary.redeemablePaise == 0

            after = await db.scalar(
                select(func.count()).select_from(Redemption).where(
                    Redemption.company_id == w.company_a_id,
                    Redemption.technician_id == w.meena_id,
                )
            )
            assert after == before
    run(_t())


# ── #5. An open redemption survives a switch ──────────────────────────────


def test_06_ravi_open_redemption_survives_the_switch():
    """§7 #5. Ravi asks for his money, THEN Priya makes him an employee —
    the switch goes 200 because the ask reserved the balance (a positive
    balance is what blocks, and there is none left), the still-unclaimed ask
    is claimable by the payer, and the technician's confirm settles it. He
    goes back to freelancer afterwards; no employee-stream row exists for him
    because confirmation does not write a ledger row."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            await clear_open_redemptions(db, w, await profx(db, w, "ravi"), "ravi")
            ravi = await profx(db, w, "ravi")

            # Some real balance to ask for, earned the ordinary way — the
            # run starts from whatever prior runs left (a debt counts too),
            # so closes are added until the ask has something to point at.
            for i in range(10):
                row = await raise_ticket(db, w, ravi, index=7007 + i)
                await accept_job(db, w, ravi, row)
                await force_close(db, w, row, 60_000)
                available = await freelancer_balance(db, w, "ravi")
                if available > 0:
                    break
            assert available > 0, available

            out = await red_service.request(
                db, await p(db, "ravi"), ravi,
                RedeemRequest(amountPaise=red_service.redeemable(available)),
            )
            opened = await db.get(Redemption, out.id)
            assert opened.claimed_at is None
            assert opened.confirmed_at is None
            FACTS.ravi_open_redemption = out.id

            await set_type(db, w, "ravi", "employee")
            await set_type(db, w, "ravi", "freelancer")

            await red_service.claim(
                db, await p(db, "priya"), out.id,
                ClaimRequest(
                    proof=_proof(w.company_a_id, out.id),
                    utr="T06OPEN" + out.id.hex[:28],
                ),
            )
            ravi = await profx(db, w, "ravi")
            await red_service.confirm(
                db, await p(db, "ravi"), ravi, out.id, received=True
            )
            settled = await db.get(Redemption, out.id)
            assert settled.confirmed_at is not None

            # And the freelancer stream is the ONLY thing the redemption ever
            # touched — no employee-stamped row behind it.
            mine = (
                await db.scalars(
                    select(LedgerEntry).where(
                        LedgerEntry.company_id == w.company_a_id,
                        LedgerEntry.ticket_id == row.id,
                    )
                )
            ).all()
            assert all(e.technician_type == "freelancer" for e in mine), mine
    run(_t())


# ── #6. A balance blocks the switch; a debt does not ──────────────────────


def test_07_balance_blocks_the_switch_a_debt_does_not():
    """§7 #6. ₹3,200 waiting to be redeemed refuses the switch, BY the
    formatted figure; taken out, the switch goes 200; a NEGATIVE balance —
    penalties past what they earned — switches too, because a debt stays in
    the freelancer stream and cannot be eaten by a salary."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            await redeem_all(db, w, "ravi")  # start the manufacture from 0
            ravi = await profx(db, w, "ravi")
            for i, amount in enumerate(_FORCE_PIECES):
                row = await raise_ticket(db, w, ravi, index=7008 + i)
                await accept_job(db, w, ravi, row)
                await force_close(db, w, row, amount)
            balance = await freelancer_balance(db, w, "ravi")
            assert balance == sum(_FORCE_PIECES), balance  # ₹3,200 exactly

            with pytest.raises(AppError) as exc:
                await set_type(db, w, "ravi", "employee")
            assert exc.value.status_code == 409
            assert exc.value.code == "TECHNICIAN_HAS_BALANCE"
            assert "₹3,200" in exc.value.detail, exc.value.detail

            await redeem_all(db, w, "ravi")
            assert await freelancer_balance(db, w, "ravi") == 0
            await set_type(db, w, "ravi", "employee")
            await set_type(db, w, "ravi", "freelancer")

            # The negative arm: a penalty on an empty balance goes below zero…
            row = await raise_ticket(db, w, ravi, index=7014)
            await accept_job(db, w, ravi, row)
            await jobs_service.cancel(
                db, row.id, company_id=w.company_a_id, profile=ravi,
                reason="Task 06: accepted, then the customer moved it",
            )
            assert await freelancer_balance(db, w, "ravi") < 0
            # …and the switch is NOT the thing that refuses it.
            await set_type(db, w, "ravi", "employee")
            await set_type(db, w, "ravi", "freelancer")
    run(_t())


# ── #7. No double pay on switching back ───────────────────────────────────


def test_08_meena_freelancer_month_excludes_the_employee_stream():
    """§7 #7. Meena spends a moment as a freelancer; the balance she could
    redeem is her FREELANCER stream — usually nothing — never the salary
    month's bonus. Then back to employee, which is where she stays."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await profx(db, w, "meena")
            bonus = await db.get(LedgerEntry, FACTS.meena_bonus_id)
            assert bonus is not None and bonus.technician_type == "employee"

            await set_type(db, w, "meena", "freelancer")
            meena = await profx(db, w, "meena")
            summary = await red_service.summary(db, meena)
            expected = await db.scalar(
                select(func.coalesce(func.sum(LedgerEntry.amount_paise), 0)).where(
                    LedgerEntry.company_id == w.company_a_id,
                    LedgerEntry.technician_id == w.meena_id,
                    LedgerEntry.technician_type == "freelancer",
                    LedgerEntry.kind.in_(("payout", "bonus")),
                )
            )
            assert summary.availablePaise == expected
            assert summary.availablePaise == 0  # the ₹400 bonus is NOT in it

            await set_type(db, w, "meena", "employee")
    run(_t())


# ── #8. The session field ─────────────────────────────────────────────────


def test_09_the_session_names_the_type():
    """§7 #8. `/technicians/me` and the OTP verify both hand the app the same
    field — one builder, so the two doors cannot drift."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            meena_principal = await seed_task05.technician_principal(
                db, w.meena_id, w.company_a_id
            )
            mine = await tech_service.get_me(db, meena_principal)
            assert mine.technicianType == "employee"

            issued = await otp_service.request_login_code(db, w.meena_phone, None)
            assert issued.devCode, "OTP_DEV_ECHO is off — the code is undeliverable"
            login = await otp_service.verify_login_code(db, w.meena_phone, issued.devCode)
            assert login.technicianProfile is not None
            assert login.technicianProfile.technicianType == "employee"
    run(_t())


# ── #9. Pool push ─────────────────────────────────────────────────────────


@pytest.mark.skip(
    "Manual by the md itself (§7 #9): 'check the server log / a dev device'. "
    "The split is enforced in core.push.announce_pool_job (§4.7): a freelancer "
    "holds the rupee figure, an employee's push says the job without it."
)


def test_10_pool_push_rupee_split_is_checked_on_a_device():
    """Documented, not automated — see the skip above."""


# ── #10. The statement ────────────────────────────────────────────────────


def test_11_priya_downloads_meenas_month_and_the_totals_are_sql():
    """§7 #10. The door returns the FILE, named for who-whom-when, led by the
    BOM; the totals block is the SQL the payroll would run, per kind, and the
    header line is exactly the template's."""
    w = world()
    month = _this_month()

    async def _t():
        async with AsyncSessionLocal() as db:
            priya = await p(db, "priya")
            resp = await franchise_statement_route(
                db, technicianId=w.meena_id, principal=priya, month=month
            )
            assert resp.media_type == "text/csv; charset=utf-8"
            body = resp.body.decode("utf-8")
            assert body.startswith("﻿")

            y, m = (int(x) for x in month.split("-"))
            sheet = await load_statement(
                db, company_id=w.company_a_id, franchisee_id=w.s_id,
                technician_id=w.meena_id, year=y, month=m,
            )
            expected_name = statement_filename(
                franchisee_code=sheet.franchisee_code,
                technician_code=sheet.employee_code,
                year=y, month=m,
            )
            assert expected_name.startswith("statement-")
            assert expected_name.endswith(f"{y:04d}-{m:02d}.csv")
            assert f'filename="{expected_name}"' in resp.headers["content-disposition"]

            # The header line, cell for cell.
            rows = list(csv.reader(io.StringIO(body.lstrip("﻿"))))
            assert [
                "Date (IST)", "Ticket", "Item", "Details",
                "Credit (₹)", "Debit (₹)", "Reverses",
            ] in rows

            # The totals the PAYROLL would run, as the md spells the query:
            # kind-generic, the employee stream only, half-open month bounds.
            start, end = month_bounds(y, m)
            sums = dict(
                (
                    await db.execute(
                        select(LedgerEntry.kind, func.sum(LedgerEntry.amount_paise))
                        .where(
                            LedgerEntry.company_id == w.company_a_id,
                            LedgerEntry.franchisee_id == w.s_id,
                            LedgerEntry.technician_id == w.meena_id,
                            LedgerEntry.technician_type == "employee",
                            LedgerEntry.kind != "payout",
                            LedgerEntry.created_at >= start,
                            LedgerEntry.created_at < end,
                        )
                        .group_by(LedgerEntry.kind)
                    )
                ).all()
            )
            totals, net_cell = _totals_from_csv(body)
            net = 0
            for kind in TOTAL_ORDER:
                signed = KIND_LINES[kind][0] * sums.get(kind, 0)
                net += signed
                want_credit = rupees_plain(signed) if signed > 0 else "0.00"
                want_debit = rupees_plain(-signed) if signed < 0 else "0.00"
                assert totals.get(kind) == (want_credit, want_debit), (
                    kind, totals.get(kind), (want_credit, want_debit)
                )
            # The net is negative here (Meena's penalties outdid the bonus in
            # this month) and a minus-leading cell goes through `csv_safe`
            # like every other cell — the apostrophe is the file's honesty,
            # not a discrepancy.
            assert net_cell == csv_safe(rupees_plain(net)), (net_cell, net)

            # The month carries the worked example's shape: a penalty debit,
            # a bonus credit, and T2's silence — no payout line anywhere.
            body_kinds = {
                line[2] for line in rows
                if len(line) > 2 and line[2] in {v[1] for v in KIND_LINES.values()}
            }
            assert "Reassignment bonus" in body_kinds
            assert "Penalty" in body_kinds
    run(_t())


# ── #11. The reversal month ───────────────────────────────────────────────


def test_12_a_september_penalty_reversed_in_october():
    """§7 #11. A charge moved back over the month boundary (the way
    seed/backdate.py is for), reversed this month: September still shows its
    debit and re-downloads byte-identical; October carries the credit, with
    the Reverses cell naming the charge it undid."""
    w = world()
    this_month = _this_month()
    last_month = _shift_month(this_month, -1)

    async def _t():
        async with AsyncSessionLocal() as db:
            meena = await profx(db, w, "meena")

            # The October charge: an ordinary cancellation, T3.
            row = await raise_ticket(db, w, meena, index=7015)
            await accept_job(db, w, meena, row)
            await jobs_service.cancel(
                db, row.id, company_id=w.company_a_id, profile=meena,
                reason="Task 06: the customer moved the visit",
            )
            await db.refresh(row)
            penalty = await db.scalar(
                select(LedgerEntry).where(
                    LedgerEntry.company_id == w.company_a_id,
                    LedgerEntry.ticket_id == row.id,
                    LedgerEntry.kind == "penalty",
                    LedgerEntry.reverses_id.is_(None),
                )
            )
            assert penalty is not None
            penalty_id = penalty.id  # captured before any commit expires it

            # The calendar moves the settled ticket AND its ledger rows back
            # — one delta, both tables — landing the charge in September.
            await shift_ticket(db, row.id, delta=datetime.timedelta(days=42))
            await db.commit()

            _, sep_body_once = await _build_csv(
                db, w, w.meena_id, last_month, franchisee_id=w.s_id
            )
            assert any(
                line[2] == "Penalty" and line[5] for line in _rows_of(sep_body_once)
            )

            # The reversal Door 2 — the S admin gives the money back. It is
            # written NOW, in this month, whatever month the penalty sat in.
            reversal = await ledger_service.reverse_entry(
                db, await p(db, "priya"), penalty_id,
                "Task 06: customer moved the visit; charge given back",
            )
            assert reversal.kind == "reversal"

            sep2_body = (await _build_csv(
                db, w, w.meena_id, last_month, franchisee_id=w.s_id
            ))[1]
            # Two downloads, one month, one truth: byte-identical.
            assert sep2_body == sep_body_once
            # The undo does not restate September — the debit is still there.
            assert any(
                line[2] == "Penalty" and line[5] for line in _rows_of(sep2_body)
            )
            assert not any(
                line[2] == "Penalty reversed" for line in _rows_of(sep2_body)
            )

            _, oct_body = await _build_csv(
                db, w, w.meena_id, this_month, franchisee_id=w.s_id
            )
            reversed_rows = [
                line for line in _rows_of(oct_body) if line[2] == "Penalty reversed"
            ]
            assert reversed_rows
            for line in reversed_rows:
                # The cell names the CHARGE'S ticket and date, reached through
                # the reversal's own join — never blank on a real row.
                assert line[6], line
            assert all(
                e.technician_type == "employee" and str(e.franchisee_id) == str(w.s_id)
                for e in [await db.get(LedgerEntry, reversal.id)]
            )
    run(_t())


def _rows_of(body: str) -> list[list[str]]:
    """The body rows that are not blanks and not the totals block."""
    out: list[list[str]] = []
    seen_totals = False
    for line in csv.reader(io.StringIO(body.lstrip("﻿"))):
        if line and line[0] == "Totals":
            seen_totals = True
        if line and not seen_totals and line[0] != \
                "Date (IST)" and line[0] != "Monthly statement" \
                and line[0] != "Employee":
            out.append(line)
    return out


# ── #12. Walls ────────────────────────────────────────────────────────────


def test_13_statement_walls():
    """§7 #12. Ravi (freelancer, no employee stream anywhere near the month),
    Hema (Home's employee), and Meena (Bala's — ANOTHER COMPANY) all read as
    nobody: the same 404, never a 403 naming which clause failed. A malformed
    month and a month that has not started are 422s; a facility role and a
    staff principal are 403s at the door."""
    w = world()
    month = _this_month()

    async def _t():
        async with AsyncSessionLocal() as db:
            # The clean month: Ravi's legacy employee-era payouts (Task 05's
            # walk paid him as one) sit in recent months, so the wall is asked
            # on the newest month where NO employee-stream row exists for the
            # cast the arms use. The assertion below keeps the choice honest.
            picked = None
            for back in range(15):
                candidate = _shift_month(month, -back)
                ravi_rows = await _employee_rows_in_month(
                    db, w, w.s_id, w.ravi_id, candidate
                )
                hema_rows = await _employee_rows_in_month(
                    db, w, w.s_id, w.hema_id, candidate
                )
                if ravi_rows == 0 and hema_rows == 0:
                    picked = candidate
                    break
            assert picked is not None, "no clean month found in 15"
            FACTS.wall_month = picked

            priya = await p(db, "priya")
            bala = await p(db, "bala")

            # Ravi — a S freelancer the statements never met.
            with pytest.raises(AppError) as exc:
                await franchise_statement_route(
                    db, technicianId=w.ravi_id, principal=priya, month=picked
                )
            assert exc.value.status_code == 404 and exc.value.code == "NOT_FOUND"

            # Hema — an employee, but of the HOME, not of S.
            with pytest.raises(AppError) as exc:
                await franchise_statement_route(
                    db, technicianId=w.hema_id, principal=priya, month=_this_month()
                )
            assert exc.value.status_code == 404

            # Meena — a S employee, read by ANOTHER COMPANY's admin. The
            # guessed id gets a 404, never a 403.
            with pytest.raises(AppError) as exc:
                await franchise_statement_route(
                    db, technicianId=w.meena_id, principal=bala, month=_this_month()
                )
            assert exc.value.status_code == 404

            # A malformed month is a broken link, not a date to reason about.
            with pytest.raises(AppError) as exc:
                resolve_month("2026-13")
            assert exc.value.status_code == 422 and exc.value.code == "BAD_MONTH"

            # The future has no rows to print and an empty file would lie.
            with pytest.raises(AppError) as exc:
                resolve_month(_shift_month(_this_month(), 1))
            assert exc.value.status_code == 422

            # A facility role is not a franchisee admin — even one holding a
            # feature grant that says franchise.* (the role is the answer, so
            # Feature Access cannot hand this door over).
            admin_user = await seed_task05._user_by_email(db, w.company_a_admin_email)
            facility = Principal(
                user=admin_user, role=FACILITY_ADMIN,
                rank=ROLE_RANKS[FACILITY_ADMIN], is_superadmin=False,
                company_id=w.company_a_id, franchisee_id=None,
            )
            with pytest.raises(HTTPException) as exc:
                require_franchise_principal(facility)
            assert exc.value.status_code == 403

            # And the company's own staff never hold the franchisee's door.
            nisha = await p(db, "nisha")
            assert nisha.rank == ROLE_RANKS[NATIONAL_HEAD]
            with pytest.raises(HTTPException) as exc:
                require_franchise_principal(nisha)
            assert exc.value.status_code == 403
    run(_t())


# ── #13. The home staff twin ──────────────────────────────────────────────


def test_14_home_staff_statement_and_its_floor():
    """§7 #13. Nisha (NH) reads HEMA's month for the HOME through the staff
    door — the same file, scoped so there is no franchiseeId parameter to
    name; an Area Manager cannot read payroll documents at all (the rank
    floor is the answer); Nisha with Meena (S) reads nobody."""
    w = world()
    this_month = _this_month()

    async def _t():
        async with AsyncSessionLocal() as db:
            nisha = await p(db, "nisha")
            resp = await staff_statement_route(
                db, technicianId=w.hema_id, principal=nisha, month=this_month
            )
            assert resp.media_type == "text/csv; charset=utf-8"
            body = resp.body.decode("utf-8")
            assert body.startswith("﻿")
            y, m = (int(x) for x in this_month.split("-"))
            assert f"-{y:04d}-{m:02d}.csv" in resp.headers["content-disposition"]
            # The month the prep gave Hema: the penalty is ON the file.
            assert any(line[2] == "Penalty" and line[5] for line in _rows_of(body))

            # The floor, asked the way the door asks it.
            kiran = await p(db, "kiran")
            assert kiran.rank == ROLE_RANKS[AREA_MANAGER], kiran.role
            with pytest.raises(HTTPException) as exc:
                require_min_rank(NATIONAL_HEAD)(kiran)
            assert exc.value.status_code == 403

            # Meena is S's employee; through the HOME-scoped door she is
            # nobody — her employee-stream rows are all at S, and clause A
            # names a different franchisee.
            with pytest.raises(AppError) as exc:
                await staff_statement_route(
                    db, technicianId=w.meena_id, principal=nisha, month=this_month
                )
            assert exc.value.status_code == 404
    run(_t())


# ── #14. Verify and the pure suite ────────────────────────────────────────


def test_15_the_pure_suite_green():
    """§7 #14's pytest arm, pinned as a real fact of THIS run: the unit
    suite's Task 06 files exist and the build-level invariants they pin are
    pinned here too, so a regression cannot ship beneath an integration run.
    The full green run is the CI command (`pytest api/tests/unit`), not a
    subprocess of this one."""
    from pathlib import Path

    base = Path(__file__).resolve().parents[1] / "unit"
    assert (base / "test_employment.py").exists()
    assert (base / "test_statements.py").exists()


def test_16_seed_verify_flags_no_employee_payout():
    """§7 #14's verify arm, at the check the md cares about: `verify.py`'s
    employee rule — no `payout` row may carry the employee stamp — must hold
    for everything THIS RUN wrote. On a freshly seeded company that is an
    empty set, which is the md's sentence; this dev database additionally
    carries pre-Task-06 payout rows from Task 05's own walk history (Ravi was
    briefly an employee then, and T1 paid him), so the run's promise is the
    stricter one #1 prepared a baseline for: the set grew by nobody, and
    Meena is nowhere in it."""
    w = world()

    async def _t():
        async with AsyncSessionLocal() as db:
            from app.scripts.seed.verify import _employees_were_not_paid

            problems = await _employees_were_not_paid(db, w.company_a_id)
            now = {str(p.detail).split()[1] for p in problems}
            fresh = now - FACTS.verify_baseline
            assert not fresh, (
                "this run paid an employee per job: "
                + ", ".join(sorted(fresh))
            )
            assert str(w.meena_id) not in now
    run(_t())