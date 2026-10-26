"""Prove the seeded data adds up, and fail loudly when it does not.

This is the half of the seed that earns the other half's trust. Driving the
real services keeps the numbers genuine while the ticket is being built;
`backdate.py` then rewrites timestamps underneath finished rows, and a missed
column there does not announce itself — it surfaces a week later as a technician
whose Earnings total disagrees with their own job list, in front of whoever is
watching the demo.

So every check below compares two things that were computed by different paths
and must agree. A check that merely re-reads what the seed wrote would pass on
broken data.
"""

import dataclasses
import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.accept_snapshot import speed_of, technician_type_of, travel_of
from app.core.franchise import franchisees_for_pincodes
from app.core.errors import AppError
from app.core.ledger import not_reversed, pool
from app.core.rules import load_rules
from app.core.statements import load_statement
from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES, TERMINAL_STATUSES
from app.features.earnings import service as earnings_service
from app.models.franchisee import (
    Franchisee,
    FranchiseePincode,
    FranchiseeTravelRule,
)
from app.models.ledger import CAPPED_KINDS, POOL_KINDS, SPEED_KINDS, LedgerEntry
from app.models.membership import Membership
from app.models.spare_part import OPEN_PART_REQUEST_STATUSES, SparePartRequest
from app.models.technician import TechnicianPincode, TechnicianProfile
from app.models.technician_transfer import TechnicianTransfer
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))


@dataclasses.dataclass
class Problem:
    check: str
    detail: str


async def run(db: AsyncSession, *, company_id: uuid.UUID) -> list[Problem]:
    """Every check, all of them, so one run reports the whole picture."""
    problems: list[Problem] = []
    for check in (
        _events_are_in_time_order,
        _closed_tickets_were_paid,
        _employees_were_not_paid,
        _ledger_franchisee_matches_the_snapshot,
        _earnings_match_the_ledger,
        _travel_matches_the_snapshot,
        _every_franchisee_has_travel_rules,
        _speed_rows_are_honest,
        _nobody_passed_the_monthly_cap,
        _pool_per_franchisee_adds_up,
        _statements_match_the_ledger,
        _live_tickets_still_have_a_future,
        _company_has_one_home,
        _open_unassigned_tickets_route_by_pincode,
        _override_flags_are_honest,
        _handed_tickets_point_at_active_franchisees,
        _technicians_on_live_franchisees,
        _parts_agree_with_status,
        _transfers_agree_with_technicians,
        _transferred_technicians_keep_their_old_money,
    ):
        problems.extend(await check(db, company_id))
    return problems


async def _events_are_in_time_order(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """A ticket's timeline must not disagree with its own clock.

    `ticket_events` are ordered by `seq`, not by `created_at`, so a backdating
    pass that moved one event and not its neighbour leaves a history that reads
    as happening backwards. Nothing in the API would ever refuse it.
    """
    rows = await db.execute(
        select(TicketEvent.ticket_id, TicketEvent.seq, TicketEvent.created_at, TicketEvent.kind)
        .where(TicketEvent.company_id == company_id)
        .order_by(TicketEvent.ticket_id, TicketEvent.seq)
    )
    problems: list[Problem] = []
    last_ticket: uuid.UUID | None = None
    last_at: datetime.datetime | None = None
    last_kind = ""
    for ticket_id, _seq, created_at, kind in rows:
        if ticket_id != last_ticket:
            last_ticket, last_at, last_kind = ticket_id, created_at, kind
            continue
        if last_at is not None and created_at < last_at:
            problems.append(
                Problem(
                    "events in time order",
                    f"ticket {ticket_id}: {kind!r} at {created_at.isoformat()} "
                    f"comes after {last_kind!r} at {last_at.isoformat()}",
                )
            )
        last_at, last_kind = created_at, kind
    return problems


async def _closed_tickets_were_paid(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """A closed job with a technician owes that technician its stamped payout.

    The one place a backdating bug would show up as MONEY rather than as a
    date: the payout row is written in the same transaction as the closure, so
    a ticket that is Closed with no payout means the ledger and the ticket
    disagree about whether work happened.

    Employees are the exception BY DESIGN (T2, Task 06): their closed job has
    no payout — salary is paid through the statement — so they are skipped
    instead of flagged. An employee-stream payout row is
    `_employees_were_not_paid`'s answer, not this check's.

    WHICH kind of technician did the job is the type FROZEN when they accepted
    it (T1, Task 10) — `accept_snapshot.technicianType` — and only a ticket
    with no snapshot (accepted before Task 10) falls back to the profile's
    type today. Reading the profile alone would flag a job a technician did as
    a freelancer and was later made an employee after, or excuse the reverse.
    """
    live_type = dict(
        (
            await db.execute(
                select(TechnicianProfile.id, TechnicianProfile.technician_type).where(
                    TechnicianProfile.company_id == company_id
                )
            )
        ).all()
    )
    paid = set(
        await db.scalars(
            select(LedgerEntry.ticket_id).where(
                LedgerEntry.company_id == company_id, LedgerEntry.kind == "payout"
            )
        )
    )
    rows = await db.execute(
        select(Ticket.id, Ticket.technician_id, Ticket.accept_snapshot).where(
            Ticket.company_id == company_id,
            Ticket.status == "Closed",
            Ticket.technician_id.is_not(None),
        )
    )
    return [
        Problem("closed tickets were paid", f"ticket {tid} is Closed with no payout row")
        for tid, technician_id, snapshot in rows
        if tid not in paid
        and technician_type_of(snapshot, live_type.get(technician_id, "freelancer"))
        == "freelancer"
    ]


async def _employees_were_not_paid(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """No employee stream may carry a `payout` row — the invariant T2 writes.

    Every writer that stamps a payout (`record_feedback`, `force_close_ticket`)
    now gates on the technician's type, but a future writer forgetting the gate
    is exactly the kind of thing the seed exists to catch: salary money paid
    twice — once by payroll, silently by the ledger — is a payroll document
    nobody can reconcile against a ledger row nobody filed.
    """
    rows = await db.scalars(
        select(LedgerEntry.technician_id).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.kind == "payout",
            LedgerEntry.technician_type == "employee",
        )
    )
    return [
        Problem(
            "employees were not paid",
            f"technician {tid} has an employee-stream payout row",
        )
        for tid in set(rows)
    ]


async def _earnings_match_the_ledger(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """The Earnings screen's own figures, against a plain sum of the rows.

    Deliberately calls the real read (`features/earnings`) rather than
    recomputing what it should say: that read applies `shown_to_technician`, is
    bounded by an IST window and is what the demo will actually show. Comparing
    it with a bare SUM is what makes this a test of two paths rather than one.
    """
    problems: list[Problem] = []
    profiles = await db.scalars(
        select(TechnicianProfile).where(TechnicianProfile.company_id == company_id)
    )
    # A year wide, so a ticket backdated six weeks is inside it. Wider than any
    # button the screen offers — the point is to catch every row, not to
    # reproduce a particular period.
    now = datetime.datetime.now(datetime.timezone.utc)
    window = (now - datetime.timedelta(days=365), now + datetime.timedelta(days=1))
    for profile in profiles:
        figures = await earnings_service.summary(
            db, company_id=company_id, technician_id=profile.id, window=window
        )
        totals = dict(
            (
                await db.execute(
                    select(LedgerEntry.kind, func.sum(LedgerEntry.amount_paise))
                    .where(
                        LedgerEntry.company_id == company_id,
                        LedgerEntry.technician_id == profile.id,
                        LedgerEntry.created_at >= window[0],
                        LedgerEntry.created_at < window[1],
                        # A given-back penalty reads as never charged, so the
                        # penalty AND the reversal row that undid it both drop
                        # out — the same answer as the screen, spelled with a
                        # different predicate (`kind` + `not_reversed`, not
                        # `shown_to_technician`) so the two stay two paths.
                        LedgerEntry.kind != "reversal",
                        not_reversed(),
                    )
                    .group_by(LedgerEntry.kind)
                )
            ).all()
        )
        # Travel FOLDS into earned (index §6a, W18) — a breakdown of the
        # `payout` + `travel` ledger rows, never a fourth term beside them.
        # Task 11 (W10): the speed kinds fold the SAME way — `speed_reward`
        # into bonuses, `speed_penalty` into penalties — so this comparison
        # reads the two sums through the same arithmetic
        # `features/earnings.service.summary` uses.
        earned = int(totals.get("payout", 0) or 0) + int(totals.get("travel", 0) or 0)
        bonuses = (
            int(totals.get("bonus", 0) or 0) + int(totals.get("speed_reward", 0) or 0)
        )
        penalties = (
            int(totals.get("penalty", 0) or 0)
            + int(totals.get("speed_penalty", 0) or 0)
        )
        expected_net = earned + bonuses - penalties
        if (
            figures.netPaise != expected_net
            or figures.earnedPaise != earned
            or figures.travelPaise != int(totals.get("travel", 0) or 0)
            or figures.speedRewardPaise != int(totals.get("speed_reward", 0) or 0)
            or figures.speedPenaltyPaise != int(totals.get("speed_penalty", 0) or 0)
        ):
            problems.append(
                Problem(
                    "earnings match the ledger",
                    f"technician {profile.code}: screen says net "
                    f"{figures.netPaise}/earned {figures.earnedPaise}/travel "
                    f"{figures.travelPaise}/speed reward "
                    f"{figures.speedRewardPaise}/speed penalty "
                    f"{figures.speedPenaltyPaise} paise, ledger sums to net "
                    f"{expected_net}, earned {earned} "
                    f"(payout {int(totals.get('payout', 0) or 0)}, travel "
                    f"{int(totals.get('travel', 0) or 0)}, bonus "
                    f"{int(totals.get('bonus', 0) or 0)}, "
                    f"penalty {int(totals.get('penalty', 0) or 0)}, "
                    f"speed reward "
                    f"{int(totals.get('speed_reward', 0) or 0)}, speed penalty "
                    f"{int(totals.get('speed_penalty', 0) or 0)})",
                )
            )
    return problems


async def _travel_matches_the_snapshot(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """Every `travel` ledger row answers to the ticket's frozen snapshot.

    Three invariants against the writers (`record_feedback`, which pays the
    FROZEN amount, and `force_close_ticket`, which pays the manager's number
    capped at the snapshot's max — W5's "omitted means none" included):

    - no travel row while the ticket's snapshot is NULL — nothing else writes
      this kind;
    - no travel row exceeds its ticket's frozen `maxPaisePerJob`;
    - a customer-closed ticket whose frozen amount is above ₹0 and whose
      snapshot names its CURRENT holder carries exactly one travel row of
      exactly that amount. Force-closed tickets are checked against the CAP
      instead — the manager's number is deliberately a different figure —
      and force-closes are told apart by the `force_closed` event the
      writer records with them.
    """
    problems: list[Problem] = []
    force_ids = set(
        await db.scalars(
            select(TicketEvent.ticket_id).where(
                TicketEvent.company_id == company_id,
                TicketEvent.kind == "force_closed",
            )
        )
    )
    tickets = {
        t.id: t
        for t in await db.scalars(
            select(Ticket).where(Ticket.company_id == company_id)
        )
    }
    rows = await db.execute(
        select(LedgerEntry.ticket_id, LedgerEntry.amount_paise).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.kind == "travel",
        )
    )
    per_ticket: dict[uuid.UUID, list[int]] = {}
    for ticket_id, amount in rows:
        ticket = tickets.get(ticket_id)
        if ticket is None or travel_of(ticket.accept_snapshot) is None:
            problems.append(
                Problem(
                    "travel matches the snapshot",
                    f"ticket {ticket_id} has a {amount} paise travel row but "
                    "no frozen snapshot",
                )
            )
            continue
        per_ticket.setdefault(ticket_id, []).append(amount)
        max_paise = travel_of(ticket.accept_snapshot).max_paise_per_job
        if amount > max_paise:
            problems.append(
                Problem(
                    "travel matches the snapshot",
                    f"ticket {ticket_id}: travel row {amount} paise exceeds "
                    f"its frozen maximum {max_paise}",
                )
            )

    for ticket in tickets.values():
        if ticket.status != "Closed":
            continue
        view = travel_of(ticket.accept_snapshot)
        if (
            view is None
            or view.amount_paise <= 0
            or view.technician_id != str(ticket.technician_id)
        ):
            continue
        rows = per_ticket.get(ticket.id, [])
        if ticket.id in force_ids:
            # The manager's number, not the frozen estimate — a row must simply
            # EXIST in range (W5's none-at-all is allowed too) and the cap was
            # checked above.
            if len(rows) > 1:
                problems.append(
                    Problem(
                        "travel matches the snapshot",
                        f"ticket {ticket.id}: {len(rows)} travel rows, force "
                        "closure pays one",
                    )
                )
            continue
        if len(rows) != 1 or rows[0] != view.amount_paise:
            problems.append(
                Problem(
                    "travel matches the snapshot",
                    f"ticket {ticket.id} is Closed: one travel row of "
                    f"{view.amount_paise} paise expected, found "
                    f"{rows or 'none'}",
                )
            )
    return problems


async def _speed_rows_are_honest(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """The speed ledger rows answer to the ticket, its snapshot and its status.

    Three invariants against the one writer (`speed_settle.settle_speed`, the
    customer-closure path only — a force-closure deliberately pays no speed
    money, S5/R7):

    - speed rows sit ONLY on Closed tickets carrying a frozen `speed` block —
      on anything else the row is money without a rule, the drift a backdate
      or a new writer would leak;
    - at most ONE per ticket (`uq_ledger_entries_speed_once` makes it true;
      checking costs one query and names the writer that broke it if the seed
      ever gains a second one);
    - NONE on a force-closed ticket, whatever the technician earned — that
      closure is exactly the case where the clock is not measurable, and an
      invented figure there is worse than none.
    """
    problems: list[Problem] = []
    by_ticket = {
        tid: (status, snapshot)
        for tid, status, snapshot in await db.execute(
            select(Ticket.id, Ticket.status, Ticket.accept_snapshot).where(
                Ticket.company_id == company_id
            )
        )
    }
    rows = await db.execute(
        select(LedgerEntry.ticket_id).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.kind.in_(SPEED_KINDS),
        )
    )
    per_ticket: dict[uuid.UUID, int] = {}
    for (ticket_id,) in rows:
        per_ticket[ticket_id] = per_ticket.get(ticket_id, 0) + 1
        status, snapshot = by_ticket.get(ticket_id, ("<missing>", None))
        known = speed_of(snapshot) is not None
        if known and status != "Closed":
            problems.append(
                Problem(
                    "speed rows are honest",
                    f"ticket {ticket_id} holds a speed ledger row but its "
                    f"status is {status!r} — the customer-closure path is the "
                    "only writer",
                )
            )
        if not known:
            # Money without a frozen rule — or without a snapshot at all —
            # which no existing writer can produce.
            problems.append(
                Problem(
                    "speed rows are honest",
                    f"ticket {ticket_id} holds a speed ledger row with no "
                    "frozen speed rule in its accept snapshot",
                )
            )
        if status == "Force-Closed":
            problems.append(
                Problem(
                    "speed rows are honest",
                    f"ticket {ticket_id} is force-closed yet carries a speed "
                    "ledger row — force-closure pays no speed money (S5)",
                )
            )
    problems.extend(
        Problem(
            "speed rows are honest",
            f"ticket {tid} holds {n} speed ledger rows, at most one is "
            "possible (§4.6)",
        )
        for tid, n in per_ticket.items()
        if n > 1
    )
    return problems


async def _every_franchisee_has_travel_rules(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """Exactly two rule rows per franchisee, one per technician type (TA4).

    `stamp_travel_rules` writes both at franchisee creation and every reader
    self-heals a missing pair, so anything else here is a writer the seed did
    not account for. A count of 2 that is really freelancer twice would pass a
    count-only test, so the types are checked too.
    """
    franchisees = (
        await db.scalars(
            select(Franchisee.id).where(
                Franchisee.company_id == company_id, Franchisee.deleted_at.is_(None)
            )
        )
    ).all()
    rows = await db.execute(
        select(
            FranchiseeTravelRule.franchisee_id,
            FranchiseeTravelRule.technician_type,
            func.count(),
        )
        .where(FranchiseeTravelRule.company_id == company_id)
        .group_by(FranchiseeTravelRule.franchisee_id, FranchiseeTravelRule.technician_type)
    )
    by_franchisee: dict[uuid.UUID, dict[str, int]] = {}
    for franchisee_id, ttype, count in rows:
        by_franchisee.setdefault(franchisee_id, {})[ttype] = count
    problems: list[Problem] = []
    for fid in franchisees:
        types = by_franchisee.get(fid, {})
        wrong = {
            t: c
            for t, c in types.items()
            if t not in ("freelancer", "employee") or c != 1
        }
        if wrong or set(types) != {"freelancer", "employee"}:
            problems.append(
                Problem(
                    "every franchisee has travel rules",
                    f"franchisee {fid} has {types or 'no'} rule rows — "
                    "expected exactly one per type",
                )
            )
    return problems


async def _nobody_passed_the_monthly_cap(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """Penalties per technician per IST calendar month, against the company cap.

    Task 11 (S6): BOTH capped kinds draw down the one `cancel_penalty_cap_paise`
    — a speed penalty of ₹15,000 is a cancellation penalty's roommate under
    ₹5,000's roof — and a given-back penalty no longer draws anything
    (`not_reversed`, which is also what `charged_this_month` reads).

    Checked AFTER backdating rather than before, because the cap counts by
    `ledger_entries.created_at` — moving a penalty across a month boundary is
    exactly the kind of shift that could quietly put a technician over.
    """
    rules = await load_rules(db, company_id)
    cap = rules.cancel_penalty_cap_paise
    if not cap:
        return []
    month = func.date_trunc(
        "month", func.timezone("Asia/Kolkata", LedgerEntry.created_at)
    )
    rows = await db.execute(
        select(
            LedgerEntry.technician_id,
            month.label("month"),
            func.sum(LedgerEntry.amount_paise),
        )
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.kind.in_(CAPPED_KINDS),
            LedgerEntry.technician_id.is_not(None),
            not_reversed(),
        )
        .group_by(LedgerEntry.technician_id, month)
        .having(func.sum(LedgerEntry.amount_paise) > cap)
    )
    return [
        Problem(
            "monthly penalty cap",
            f"technician {tech}: {total} paise of penalties in "
            f"{when:%B %Y} IST, above the cap of {cap}",
        )
        for tech, when, total in rows
    ]


async def _live_tickets_still_have_a_future(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """An unsettled ticket must keep a slot that has not happened yet.

    This is the check that protects the load test rather than the demo. The job
    pool only offers work whose slot is still ahead, so a live ticket that was
    backdated by mistake vanishes from every technician's pool — and an empty
    pool under load measures nothing at all.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    stale = await db.scalars(
        select(Ticket.id).where(
            Ticket.company_id == company_id,
            Ticket.status.not_in(TERMINAL_STATUSES),
            Ticket.slot_start.is_not(None),
            Ticket.slot_start < now,
        )
    )
    return [
        Problem(
            "live tickets still have a future",
            f"ticket {tid} is unsettled but its slot has already passed — the "
            f"pool will not offer it",
        )
        for tid in stale
    ]


async def _company_has_one_home(db: AsyncSession, company_id: uuid.UUID) -> list[Problem]:
    """F4: a company has exactly one live home franchisee, and it owns no pincode rows.

    The home is the catch-all — "everything no other franchisee owns" — which
    is only true if it never acquires a `franchisee_pincodes` row of its own.
    """
    homes = (
        await db.scalars(
            select(Franchisee.id).where(
                Franchisee.company_id == company_id,
                Franchisee.is_home.is_(True),
                Franchisee.deleted_at.is_(None),
            )
        )
    ).all()
    problems: list[Problem] = []
    if len(homes) != 1:
        problems.append(
            Problem(
                "company has one home",
                f"company {company_id} has {len(homes)} live home franchisee(s), expected 1",
            )
        )
        return problems
    owned = await db.scalar(
        select(func.count())
        .select_from(FranchiseePincode)
        .where(FranchiseePincode.company_id == company_id, FranchiseePincode.franchisee_id == homes[0])
    )
    if owned:
        problems.append(
            Problem(
                "company has one home",
                f"home franchisee {homes[0]} owns {owned} franchisee_pincodes row(s); it should own none",
            )
        )
    return problems


async def _open_unassigned_tickets_route_by_pincode(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """An open, unassigned ticket's stamped franchisee must agree with its pincode, today.

    Two paths that must agree: what `create_ticket` stamped at intake, and what
    `franchisees_for_pincodes` answers right now. They stay in step after Task
    03 ships, because F6's carve-out re-stamps exactly this set when a pincode
    changes owner.

    A ticket a person HANDED to another franchisee (`routing_override`, Task 18) is excluded: its stamp
    deliberately disagrees with the pincode, and reporting it as drift would flag every hand-over.
    """
    rows = (
        await db.execute(
            select(Ticket.id, Ticket.pincode, Ticket.franchisee_id).where(
                Ticket.company_id == company_id,
                Ticket.status.in_(("New", "Slot Pending")),
                Ticket.technician_id.is_(None),
                Ticket.deleted_at.is_(None),
                Ticket.routing_override.is_(False),
            )
        )
    ).all()
    if not rows:
        return []
    routes = await franchisees_for_pincodes(db, company_id, {pincode for _id, pincode, _f in rows})
    return [
        Problem(
            "open unassigned tickets route by pincode",
            f"ticket {tid} is stamped franchisee {stamped} but pincode {pincode} "
            f"now routes to {routes.get(pincode)}",
        )
        for tid, pincode, stamped in rows
        if routes.get(pincode) != stamped
    ]


async def _handed_tickets_point_at_active_franchisees(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """No unassigned ticket with `routing_override` is stamped with an inactive or soft-deleted franchisee.

    Task 18 (H5): deactivating a franchisee hands its unassigned handed-over tickets back to their
    pincode owner, so a survivor means that step was skipped (or the franchisee was switched off by
    a script) - the ticket would sit where nobody can be offered it.
    """
    rows = await db.scalars(
        select(Ticket.id)
        .join(
            Franchisee,
            (Franchisee.company_id == Ticket.company_id) & (Franchisee.id == Ticket.franchisee_id),
        )
        .where(
            Ticket.company_id == company_id,
            Ticket.routing_override.is_(True),
            Ticket.technician_id.is_(None),
            Ticket.deleted_at.is_(None),
            Ticket.status.not_in(("Closed", "Force-Closed", "Cancelled")),
            (Franchisee.deleted_at.is_not(None)) | (Franchisee.is_active.is_(False)),
        )
    )
    return [
        Problem(
            "handed tickets point at active franchisees",
            f"ticket {tid} was handed to a franchisee that is inactive or deleted and is unassigned",
        )
        for tid in rows
    ]


async def _technicians_on_live_franchisees(db: AsyncSession, company_id: uuid.UUID) -> list[Problem]:
    """No live technician points at a franchisee that is deleted or inactive."""
    rows = await db.scalars(
        select(TechnicianProfile.id)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(Franchisee, Franchisee.id == TechnicianProfile.franchisee_id)
        .where(
            TechnicianProfile.company_id == company_id,
            Membership.deleted_at.is_(None),
            (Franchisee.deleted_at.is_not(None)) | (Franchisee.is_active.is_(False)),
        )
    )
    return [
        Problem(
            "technicians on live franchisees",
            f"technician profile {tid} points at a deleted or inactive franchisee",
        )
        for tid in rows
    ]


async def _parts_agree_with_status(db: AsyncSession, company_id: uuid.UUID) -> list[Problem]:
    """Spare-part requests and the job's status say the same thing (Task 12, §4.11).

    Computed two ways, which must agree: the ticket's `status` column against the
    set of its requests (`core.spare_parts.job_status_after` is the one writer of
    the move, under the ticket lock, so a disagreement names a writer that
    skipped it). Four invariants:

    - every ticket in `Awaiting Part` has at least one `requested`/`approved`
      request;
    - every ticket with such a request is `Awaiting Part` OR terminal — a
      force-closure may leave one open (D6/D7), nothing else may;
    - every request's `franchisee_id` equals its ticket's (D2: the job's desk);
    - every request's `technician_id` equals the ticket's current technician
      while the job is still in the requestable zone (`In Progress` /
      `Awaiting Part`); past that a customer refusal can legitimately re-assign
      the job and the earlier holder's requests stay as the log they are.
    """
    problems: list[Problem] = []
    requests = (
        await db.execute(
            select(
                SparePartRequest.code,
                SparePartRequest.ticket_id,
                SparePartRequest.franchisee_id,
                SparePartRequest.technician_id,
                SparePartRequest.status,
            ).where(SparePartRequest.company_id == company_id)
        )
    ).all()
    tickets = {
        tid: (code, status, franchisee_id, technician_id)
        for tid, code, status, franchisee_id, technician_id in await db.execute(
            select(
                Ticket.id,
                Ticket.code,
                Ticket.status,
                Ticket.franchisee_id,
                Ticket.technician_id,
            ).where(Ticket.company_id == company_id, Ticket.deleted_at.is_(None))
        )
    }
    open_by_ticket: dict[uuid.UUID, int] = {}
    for code, ticket_id, franchisee_id, technician_id, status in requests:
        ticket = tickets.get(ticket_id)
        if ticket is None:
            continue
        t_code, t_status, t_franchisee, t_technician = ticket
        if status in OPEN_PART_REQUEST_STATUSES:
            open_by_ticket[ticket_id] = open_by_ticket.get(ticket_id, 0) + 1
            if t_status != "Awaiting Part" and t_status not in TERMINAL_STATUSES:
                problems.append(
                    Problem(
                        "parts agree with status",
                        f"request {code} is {status} but ticket {t_code} is "
                        f"{t_status!r}, not Awaiting Part",
                    )
                )
        if franchisee_id != t_franchisee:
            problems.append(
                Problem(
                    "parts agree with status",
                    f"request {code} is on franchisee {franchisee_id} but its "
                    f"ticket {t_code} is on {t_franchisee}",
                )
            )
        if technician_id != t_technician and t_status in ("In Progress", "Awaiting Part"):
            problems.append(
                Problem(
                    "parts agree with status",
                    f"request {code} was raised by technician {technician_id} "
                    f"but ticket {t_code} ({t_status}) is held by {t_technician}",
                )
            )
    for ticket_id, (t_code, t_status, _f, _t) in tickets.items():
        if t_status == "Awaiting Part" and not open_by_ticket.get(ticket_id):
            problems.append(
                Problem(
                    "parts agree with status",
                    f"ticket {t_code} is Awaiting Part but has no requested or "
                    "approved spare-part request",
                )
            )
    return problems


async def _transfers_agree_with_technicians(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """A technician's recorded moves say where they are now (Task 17, §7.20/§7.21).

    For every technician with a `technician_transfers` row, looking at the NEWEST:

    - `technician_profiles.franchisee_id` equals that row's `to_franchisee_id`;
    - no code the move took off (`coverage_before` minus `coverage_after`) is in
      the technician's coverage now - a trimmed code has not crept back.

    Plus, over the whole history of one technician, each row starts where the
    previous one ended (`from_franchisee_id` = the previous `to_franchisee_id`),
    which is what makes the audit a chain rather than a pile.

    ⚠ A later Task 03 carve-out also moves technicians (and writes only a
    `technician_moved` bell, no transfer row), so a mismatch here is a prompt to
    look, not always a bug: check for a carve-out after the row's `transferred_at`
    before calling it wrong.
    """
    problems: list[Problem] = []
    rows = (
        await db.execute(
            select(TechnicianTransfer)
            .where(TechnicianTransfer.company_id == company_id)
            .order_by(TechnicianTransfer.technician_id, TechnicianTransfer.transferred_at,
                      TechnicianTransfer.id)
        )
    ).scalars().all()
    by_tech: dict[uuid.UUID, list[TechnicianTransfer]] = {}
    for r in rows:
        by_tech.setdefault(r.technician_id, []).append(r)
    if not by_tech:
        return problems

    current_franchisee = dict(
        (
            await db.execute(
                select(TechnicianProfile.id, TechnicianProfile.franchisee_id).where(
                    TechnicianProfile.company_id == company_id,
                    TechnicianProfile.id.in_(by_tech),
                )
            )
        ).all()
    )
    coverage: dict[uuid.UUID, set[str]] = {}
    for tid, code in await db.execute(
        select(TechnicianPincode.technician_id, TechnicianPincode.pincode).where(
            TechnicianPincode.company_id == company_id,
            TechnicianPincode.technician_id.in_(by_tech),
        )
    ):
        coverage.setdefault(tid, set()).add(code)

    for tid, history in by_tech.items():
        newest = history[-1]
        if current_franchisee.get(tid) != newest.to_franchisee_id:
            problems.append(
                Problem(
                    "transfers agree with technicians",
                    f"technician {tid} is on franchisee {current_franchisee.get(tid)} but "
                    f"their newest transfer ({newest.transferred_at:%Y-%m-%d %H:%M}) "
                    f"moved them to {newest.to_franchisee_id}",
                )
            )
        taken_off = set(newest.coverage_before) - set(newest.coverage_after)
        crept_back = sorted(taken_off & coverage.get(tid, set()))
        if crept_back:
            problems.append(
                Problem(
                    "transfers agree with technicians",
                    f"technician {tid} covers {', '.join(crept_back)} again, which their "
                    "newest transfer took off",
                )
            )
        for earlier, later in zip(history, history[1:]):
            if later.from_franchisee_id != earlier.to_franchisee_id:
                problems.append(
                    Problem(
                        "transfers agree with technicians",
                        f"technician {tid}: a transfer at {later.transferred_at:%Y-%m-%d %H:%M} "
                        f"starts from {later.from_franchisee_id} but the one before ended "
                        f"on {earlier.to_franchisee_id}",
                    )
                )
    return problems


async def _ledger_franchisee_matches_the_snapshot(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """Two writers, one fact: the ledger's stamps and the accept snapshot's.

    `core.ledger.entry` stamps `franchisee_id` and `technician_type` from the
    technician's PROFILE at write time (index §3.2); `accept_snapshot` froze
    the same two facts from the same profile at accept. For a customer-closed
    job they are the same person in the same state, so every `payout`,
    `travel` and `speed_*` row must repeat what the snapshot says — a
    difference means one writer bypassed the other (a profile edited under an
    open job, or a ledger writer passing its own stamp).

    A `reversal` has no snapshot of its own: it must carry the franchisee AND
    the type of the penalty it undoes (the money returns to the pool that
    collected it, even after the technician moved).

    ⚠ A Task 03 carve-out can move a technician while a job they accepted is
    open (assigned jobs keep their technician, the technician moves), and the
    row then correctly says the NEW franchisee against an OLD snapshot. In a
    seeded company nothing moves mid-job; on a real one, a hit here is a
    prompt to look at the technician's history before calling it a bug.
    """
    problems: list[Problem] = []
    rows = await db.execute(
        select(
            LedgerEntry.id,
            LedgerEntry.ticket_id,
            LedgerEntry.kind,
            LedgerEntry.franchisee_id,
            LedgerEntry.technician_type,
            Ticket.accept_snapshot,
        )
        .join(
            Ticket,
            (Ticket.company_id == LedgerEntry.company_id)
            & (Ticket.id == LedgerEntry.ticket_id),
        )
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.kind.in_(("payout", "travel", *SPEED_KINDS)),
            Ticket.accept_snapshot.is_not(None),
        )
    )
    for entry_id, ticket_id, kind, franchisee_id, technician_type, snapshot in rows:
        if not isinstance(snapshot, dict):
            continue
        if str(franchisee_id) != str(snapshot.get("franchiseeId")):
            problems.append(
                Problem(
                    "ledger franchisee matches the snapshot",
                    f"{kind} row {entry_id} on ticket {ticket_id} is stamped "
                    f"franchisee {franchisee_id}, the accept snapshot says "
                    f"{snapshot.get('franchiseeId')}",
                )
            )
        if technician_type != snapshot.get("technicianType"):
            problems.append(
                Problem(
                    "ledger franchisee matches the snapshot",
                    f"{kind} row {entry_id} on ticket {ticket_id} is stamped "
                    f"{technician_type!r}, the accept snapshot says "
                    f"{snapshot.get('technicianType')!r}",
                )
            )

    penalty = aliased(LedgerEntry)
    reversals = await db.execute(
        select(
            LedgerEntry.id,
            LedgerEntry.franchisee_id,
            LedgerEntry.technician_type,
            penalty.franchisee_id,
            penalty.technician_type,
        )
        .join(
            penalty,
            (penalty.company_id == LedgerEntry.company_id)
            & (penalty.id == LedgerEntry.reverses_id),
        )
        .where(LedgerEntry.company_id == company_id, LedgerEntry.kind == "reversal")
    )
    for entry_id, franchisee_id, ttype, penalty_franchisee, penalty_type in reversals:
        if franchisee_id != penalty_franchisee or ttype != penalty_type:
            problems.append(
                Problem(
                    "ledger franchisee matches the snapshot",
                    f"reversal {entry_id} is stamped {franchisee_id}/{ttype} but "
                    f"the penalty it undoes is {penalty_franchisee}/{penalty_type}",
                )
            )
    return problems


async def _pool_per_franchisee_adds_up(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """Each franchisee's pool, read two ways (F12).

    `core.ledger.pool` is what the console prints; the SQL here is the formula
    written out in the index — `balance = penalties + speed penalties −
    reversals − bonuses − speed rewards`, every term scoped by
    `ledger_entries.franchisee_id` — with no JOIN to the reversed row, so the
    two share nothing but the table. `penaltiesCollectedPaise −
    bonusesPaidPaise = balancePaise` is the identity the screen prints.
    A reversal subtracts whatever it undid, which is why the plain
    reversal total (and not a per-target split) is the right term here.
    """
    problems: list[Problem] = []
    sums: dict[uuid.UUID, dict[str, int]] = {}
    rows = await db.execute(
        select(
            LedgerEntry.franchisee_id,
            LedgerEntry.kind,
            func.coalesce(func.sum(LedgerEntry.amount_paise), 0),
        )
        .where(LedgerEntry.company_id == company_id, LedgerEntry.kind.in_(POOL_KINDS))
        .group_by(LedgerEntry.franchisee_id, LedgerEntry.kind)
    )
    for franchisee_id, kind, total in rows:
        sums.setdefault(franchisee_id, {})[kind] = int(total)
    franchisees = (
        await db.scalars(select(Franchisee.id).where(Franchisee.company_id == company_id))
    ).all()
    for fid in set(franchisees) | set(sums):
        by = sums.get(fid, {})
        expected = (
            by.get("penalty", 0)
            + by.get("speed_penalty", 0)
            - by.get("reversal", 0)
            - by.get("bonus", 0)
            - by.get("speed_reward", 0)
        )
        figures = await pool(db, company_id=company_id, franchisee_id=fid)
        if figures["balancePaise"] != expected:
            problems.append(
                Problem(
                    "pool per franchisee adds up",
                    f"franchisee {fid}: pool() says balance "
                    f"{figures['balancePaise']} paise, the rows sum to {expected}",
                )
            )
        if (
            figures["penaltiesCollectedPaise"] - figures["bonusesPaidPaise"]
            != figures["balancePaise"]
        ):
            problems.append(
                Problem(
                    "pool per franchisee adds up",
                    f"franchisee {fid}: collected {figures['penaltiesCollectedPaise']} "
                    f"- paid {figures['bonusesPaidPaise']} is not the balance "
                    f"{figures['balancePaise']}",
                )
            )
    return problems


async def _statements_match_the_ledger(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """An employee's monthly statement against the rows it is built from.

    For every (employee-stream technician, franchisee, IST month) that holds
    ledger rows, the file's per-kind totals — `core.statements.load_statement`,
    the loader both statement doors call — must equal a plain SUM of
    `ledger_entries` with `technician_type = 'employee'` and `kind <> 'payout'`
    in that month (Task 06 §7.10's SQL). A month with rows is checked whoever
    the technician is NOW, because a statement is written, not restated.
    """
    problems: list[Problem] = []
    month = func.date_trunc("month", func.timezone("Asia/Kolkata", LedgerEntry.created_at))
    rows = await db.execute(
        select(
            LedgerEntry.technician_id,
            LedgerEntry.franchisee_id,
            month.label("month"),
            LedgerEntry.kind,
            func.sum(LedgerEntry.amount_paise),
        )
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_type == "employee",
            LedgerEntry.kind != "payout",
            LedgerEntry.technician_id.is_not(None),
        )
        .group_by(LedgerEntry.technician_id, LedgerEntry.franchisee_id, month, LedgerEntry.kind)
    )
    expected: dict[tuple, dict[str, int]] = {}
    for technician_id, franchisee_id, when, kind, total in rows:
        expected.setdefault((technician_id, franchisee_id, when.year, when.month), {})[
            kind
        ] = int(total)
    for (technician_id, franchisee_id, year, mon), by_kind in expected.items():
        try:
            sheet = await load_statement(
                db,
                company_id=company_id,
                franchisee_id=franchisee_id,
                technician_id=technician_id,
                year=year,
                month=mon,
            )
        except AppError as exc:
            problems.append(
                Problem(
                    "statements match the ledger",
                    f"technician {technician_id} has employee rows in "
                    f"{year}-{mon:02d} but the statement answers {exc.status_code}",
                )
            )
            continue
        written: dict[str, int] = {}
        for row in sheet.rows:
            written[row.kind] = written.get(row.kind, 0) + row.amount_paise
        if written != by_kind:
            problems.append(
                Problem(
                    "statements match the ledger",
                    f"technician {technician_id}, {year}-{mon:02d}: the statement "
                    f"totals {written}, the ledger rows sum to {by_kind}",
                )
            )
    return problems


async def _override_flags_are_honest(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """`routing_override` is derived, so it can be checked (Task 18, R10).

    The service sets it to `target != owner of the pincode` and clears it when
    a ticket is handed back, so a flagged ticket whose franchisee IS the owner
    of its pincode means the flag outlived the reason for it — and a technician
    outside the pincode's range would still be offered the job.

    ⚠ A later carve-out that gives the handed-to franchisee that very pincode
    leaves the flag standing (the planner skips override tickets on purpose),
    so a hit is a prompt to look at the pincode's history first.
    """
    rows = (
        await db.execute(
            select(Ticket.id, Ticket.pincode, Ticket.franchisee_id).where(
                Ticket.company_id == company_id,
                Ticket.routing_override.is_(True),
                Ticket.deleted_at.is_(None),
            )
        )
    ).all()
    if not rows:
        return []
    owners = await franchisees_for_pincodes(
        db, company_id, {pincode for _id, pincode, _f in rows}
    )
    return [
        Problem(
            "override flags are honest",
            f"ticket {tid} is flagged as handed over but franchisee {fid} owns "
            f"its pincode {pincode} anyway",
        )
        for tid, pincode, fid in rows
        if owners.get(pincode) == fid
    ]


async def _transferred_technicians_keep_their_old_money(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """History stays where it was earned (Task 17, R9).

    A technician's ledger rows written BEFORE a transfer carry the franchisee
    they had then, and rows written after carry the new one: the transfer row's
    `transferred_at` is the boundary. A `reversal` is skipped — it deliberately
    copies the penalty's franchisee, whenever it was written.

    ⚠ Same caveat as `_transfers_agree_with_technicians`: a carve-out also moves
    technicians without a transfer row, so a hit is a prompt to look.
    """
    problems: list[Problem] = []
    transfers = (
        await db.execute(
            select(TechnicianTransfer)
            .where(TechnicianTransfer.company_id == company_id)
            .order_by(TechnicianTransfer.technician_id, TechnicianTransfer.transferred_at)
        )
    ).scalars().all()
    by_tech: dict[uuid.UUID, list[TechnicianTransfer]] = {}
    for t in transfers:
        by_tech.setdefault(t.technician_id, []).append(t)
    if not by_tech:
        return problems
    ledger = await db.execute(
        select(
            LedgerEntry.id,
            LedgerEntry.technician_id,
            LedgerEntry.kind,
            LedgerEntry.franchisee_id,
            LedgerEntry.created_at,
        ).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id.in_(by_tech),
            LedgerEntry.kind != "reversal",
        )
    )
    for entry_id, technician_id, kind, franchisee_id, created_at in ledger:
        history = by_tech[technician_id]
        expected = history[0].from_franchisee_id
        for t in history:
            if created_at >= t.transferred_at:
                expected = t.to_franchisee_id
        if franchisee_id != expected:
            problems.append(
                Problem(
                    "transferred technicians keep their old money",
                    f"{kind} row {entry_id} of technician {technician_id} written "
                    f"{created_at:%Y-%m-%d %H:%M} is stamped {franchisee_id}, "
                    f"the transfer history says {expected}",
                )
            )
    return problems


async def rows_read(db: AsyncSession, company_id: uuid.UUID) -> dict[str, int]:
    """How many rows the franchisee-era checks above had to read.

    A check that reads nothing passes on anything (index §8 trap 12), and a seed
    that quietly stops producing employees, travel or parts would turn half of
    `run()` into a formality. The seeds print this beside the verdict so an
    empty row is seen — it is a count, not a pass/fail, because a very small
    `--tickets` run can honestly produce none of some things.
    """

    async def count(stmt) -> int:
        return int(await db.scalar(stmt) or 0)

    def ledger(*kinds: str, ttype: str | None = None):
        stmt = (
            select(func.count())
            .select_from(LedgerEntry)
            .where(LedgerEntry.company_id == company_id, LedgerEntry.kind.in_(kinds))
        )
        if ttype:
            stmt = stmt.where(LedgerEntry.technician_type == ttype)
        return stmt

    return {
        "franchisees (non-home)": await count(
            select(func.count())
            .select_from(Franchisee)
            .where(
                Franchisee.company_id == company_id,
                Franchisee.is_home.is_(False),
                Franchisee.deleted_at.is_(None),
            )
        ),
        "technicians on a non-home franchisee": await count(
            select(func.count())
            .select_from(TechnicianProfile)
            .join(
                Franchisee,
                (Franchisee.company_id == TechnicianProfile.company_id)
                & (Franchisee.id == TechnicianProfile.franchisee_id),
            )
            .where(
                TechnicianProfile.company_id == company_id,
                Franchisee.is_home.is_(False),
            )
        ),
        "employees": await count(
            select(func.count())
            .select_from(TechnicianProfile)
            .where(
                TechnicianProfile.company_id == company_id,
                TechnicianProfile.technician_type == "employee",
            )
        ),
        "travel rows": await count(ledger("travel")),
        "speed rows": await count(ledger(*SPEED_KINDS)),
        "employee-stream rows": await count(
            ledger("bonus", "travel", "penalty", *SPEED_KINDS, "reversal", ttype="employee")
        ),
        "closed tickets": await count(
            select(func.count())
            .select_from(Ticket)
            .where(Ticket.company_id == company_id, Ticket.status == "Closed")
        ),
        "tickets awaiting a part": await count(
            select(func.count())
            .select_from(Ticket)
            .where(Ticket.company_id == company_id, Ticket.status == "Awaiting Part")
        ),
        "part requests": await count(
            select(func.count())
            .select_from(SparePartRequest)
            .where(SparePartRequest.company_id == company_id)
        ),
        "handed-over tickets": await count(
            select(func.count())
            .select_from(Ticket)
            .where(Ticket.company_id == company_id, Ticket.routing_override.is_(True))
        ),
        "technician transfers": await count(
            select(func.count())
            .select_from(TechnicianTransfer)
            .where(TechnicianTransfer.company_id == company_id)
        ),
    }
