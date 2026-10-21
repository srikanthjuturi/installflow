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

from app.core.franchise import franchisees_for_pincodes
from app.core.rules import load_rules
from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES, TERMINAL_STATUSES
from app.features.earnings import service as earnings_service
from app.models.franchisee import Franchisee, FranchiseePincode
from app.models.ledger import LedgerEntry
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
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
        _earnings_match_the_ledger,
        _nobody_passed_the_monthly_cap,
        _live_tickets_still_have_a_future,
        _company_has_one_home,
        _open_unassigned_tickets_route_by_pincode,
        _technicians_on_live_franchisees,
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
    no payout — salary is paid through the statement — so a freelancer-only
    join on `technician_type` drops their tickets out instead of flagging them.
    An employee-stream payout row is `_employees_were_not_paid`'s answer, not
    this check's.
    """
    # Freelancers only — an employee's silence in the ledger is correctness.
    freelancers = (
        select(TechnicianProfile.id)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.technician_type == "freelancer",
        )
        .scalar_subquery()
    )
    paid = (
        select(LedgerEntry.ticket_id)
        .where(LedgerEntry.company_id == company_id, LedgerEntry.kind == "payout")
        .scalar_subquery()
    )
    unpaid = await db.scalars(
        select(Ticket.id).where(
            Ticket.company_id == company_id,
            Ticket.status == "Closed",
            Ticket.technician_id.is_not(None),
            Ticket.technician_id.in_(freelancers),
            Ticket.id.not_in(paid),
        )
    )
    return [
        Problem("closed tickets were paid", f"ticket {tid} is Closed with no payout row")
        for tid in unpaid
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
                    )
                    .group_by(LedgerEntry.kind)
                )
            ).all()
        )
        earned = int(totals.get("payout", 0) or 0)
        bonuses = int(totals.get("bonus", 0) or 0)
        penalties = int(totals.get("penalty", 0) or 0)
        expected_net = earned + bonuses - penalties
        if figures.netPaise != expected_net:
            problems.append(
                Problem(
                    "earnings match the ledger",
                    f"technician {profile.code}: screen says net "
                    f"{figures.netPaise} paise, ledger sums to {expected_net} "
                    f"(payout {earned}, bonus {bonuses}, penalty {penalties})",
                )
            )
    return problems


async def _nobody_passed_the_monthly_cap(
    db: AsyncSession, company_id: uuid.UUID
) -> list[Problem]:
    """Penalties per technician per IST calendar month, against the company cap.

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
            LedgerEntry.kind == "penalty",
            LedgerEntry.technician_id.is_not(None),
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
    """
    rows = (
        await db.execute(
            select(Ticket.id, Ticket.pincode, Ticket.franchisee_id).where(
                Ticket.company_id == company_id,
                Ticket.status.in_(("New", "Slot Pending")),
                Ticket.technician_id.is_(None),
                Ticket.deleted_at.is_(None),
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
