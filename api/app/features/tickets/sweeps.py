"""The things time raises, not people.

Run by `core.scheduler.ticker`. Each returns how many notifications it wrote.

Five of them now, and one is different in kind: `sweep_no_shows` reports a
FAILURE that has already happened rather than a risk that still can be
prevented. It deliberately changes nothing and charges nothing — see its own
note on why a clock must not be allowed to fine anybody.

## Idempotency is checked against whatever the sweep already changed

A sweep runs every few minutes and will keep seeing the same overdue ticket
until somebody deals with it. Rather than keeping a separate "already warned"
marker — a column that would have to be reset correctly by every path that
resolves a ticket — each sweep asks whether the thing it does has already been
done. The record IS the marker, so the two cannot disagree.

For the two that only raise a notification, that record is the notification
(`_already`). For the two that change something, it is the change: an escalation
is settled by a guarded UPDATE off `status = 'New'`, and a slot reminder by a
`reminded` event. Those two are the stronger form, because they also settle the
race against whatever else is moving the same ticket.

## Why the timestamps come from `ticket_events`

There is no `slot_requested_at` or `feedback_requested_at` column, and there
should not be: this codebase's rule is that a ticket's history lives in
`ticket_events`, not in its status column. "When did we ask the customer" is a
moment, and the event is where moments are kept.

## Every window is the TICKET'S OWN COMPANY'S

These four sweeps run across the whole database at once — one tick, every
tenant — so the thresholds cannot be Python constants folded into a
`timedelta` before the query. They were exactly that until `company_rules`
existed, which is how a multi-tenant product ended up with one escalation
window for the entire deployment.

Each sweep now JOINs `company_rules` and does the arithmetic in SQL, so the row
supplies its own company's number and one query still serves every tenant.
`INTERVAL '1 hour' * rules.column` is the Postgres spelling; multiplying an
interval by an integer column is exact, and it keeps the comparison on the
indexed `slot_start` rather than wrapping it in a function.

The join is INNER on purpose: a company with no rules row would silently drop
out of every sweep, and a missed escalation looks like nothing at all. Three
things keep the row there — the migration backfilled every company,
`companies.service.create_company` writes one, and `core.rules.load_rules`
repairs it on the next read.
"""

import datetime
import logging
import uuid

from sqlalchemy import func, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.escalation import escalate, hours_to, whatsapp_the_area_manager
from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.realtime import publish_notification, publish_ticket_changed
from app.core.tickets import NO_SHOW_GRACE_MINUTES, NO_SHOW_LOOKBACK_HOURS
from app.features.tickets.service import clock
from app.models.company_rules import CompanyRules
from app.models.notification import Notification
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent


log = logging.getLogger(__name__)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


#: A rule column as a time span, for date arithmetic in SQL.
#:
#: `interval '1 hour' * <int column>` rather than `make_interval(hours => ...)`:
#: multiplication by an integer column is exact, reads as what it is, and does
#: not depend on SQLAlchemy rendering Postgres's named-argument notation.
def _hours(column):
    return column * literal_column("interval '1 hour'")


def _minutes(column):
    return column * literal_column("interval '1 minute'")


def _slot_clock(row: Ticket) -> str:
    """`2:00 PM` — the slot's start as the technician will read it.

    `f"{row.slot_start:%H:%M}"` shipped here, and it was wrong twice over.
    `slot_start` is a UTC instant, so a two-o'clock appointment reached the
    technician's phone as **"starts at 08:30"** — five and a half hours adrift,
    on the one notification whose whole job is stopping somebody being late.
    And 24-hour clock is not the house style: every approved screen in both
    apps reads `2:00 PM`.

    `clock()` is the slice's own formatter and already gets both right.
    """
    hm, meridiem = clock(row.slot_start)
    return f"{hm} {meridiem}"


def _already(kind: str) -> select:
    """Ticket ids that have already had this kind of notification raised."""
    return select(Notification.ticket_id).where(
        Notification.kind == kind, Notification.ticket_id.is_not(None)
    )


async def _raise_for(
    db: AsyncSession,
    rows: list[Ticket],
    *,
    kind: str,
    title: "callable",
    detail: "callable",
    vendor: bool = False,
) -> int:
    """Write one notification per ticket and ring the bells. Never commits.

    The caller commits — `core.scheduler` does, which is also what releases the
    advisory lock. Publishing inside that transaction is safe for the same
    reason it is everywhere else here: `pg_notify` is transactional, so a
    rolled-back sweep never tells anybody anything.
    """
    for row in rows:
        raised = await notify(
            db,
            company_id=row.company_id,
            kind=kind,
            title=title(row),
            detail=detail(row),
            to=f"/tickets/{row.id}",
            ticket_id=row.id,
            pincode=row.pincode,
            vendor_id=row.vendor_id if vendor else None,
        )
        await publish_notification(
            db,
            company_id=row.company_id,
            pincode=row.pincode,
            vendor_id=row.vendor_id if vendor else None,
            notification_id=raised.id,
        )
    return len(rows)


async def sweep_unaccepted(db: AsyncSession) -> int:
    """Nobody has accepted a job whose slot is close. Escalate it.

    The core operational safety net, and the reason the `escalation` kind was
    defined in the first place. Without it a job simply misses its slot and the
    first anyone hears of it is the customer ringing.

    The window matches the domain's own penalty band: under four hours to the
    slot is the point at which a cancellation escalates to the Area Service
    Manager, so it is the point at which an EMPTY job should reach them too.

    ## It MOVES the ticket, and that is the whole change

    This used to raise a notification and change nothing: the ticket stayed
    `New`, stayed in the pool, and stayed everybody's problem in general and
    nobody's in particular. It now goes to `Escalated`, which takes it out of
    `pool_query` — no technician can take it while a manager owns it, and the
    two ways back out are `assign_technician` and `add_bonus_and_renotify`.

    `Escalated` already meant "the customer said it was not done". The two are
    told apart by `technician_id`: a refusal always has one, this never does.

    ## Idempotency is the transition itself, not a notification marker

    The other three sweeps dedupe against `notifications` via `_already`. This
    one cannot, and must not: a job re-published WITH a bonus that again goes
    unaccepted has to escalate a second time and ring a second bell, and the
    old marker suppressed exactly that — silently, on the one screen where a
    hidden row is a missed slot.

    The guarded UPDATE below is a better marker anyway. It settles the race with
    `jobs.service.accept` in the WHERE clause: a technician who accepted between
    the SELECT and the UPDATE wins, `rowcount` is 0, and nothing is recorded
    about a job that is no longer empty.
    """
    now = _now()
    # A manager's re-notification gets its grace period. Same shape as the
    # `slot_requested` subquery in `sweep_silent_slots`: the latest event of a
    # kind, compared against a cutoff.
    renotified = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.kind == "bonus_added",
        )
        .scalar_subquery()
    )
    candidates = list(
        await db.scalars(
            select(Ticket)
            .join(CompanyRules, CompanyRules.company_id == Ticket.company_id)
            .where(
                Ticket.status == "New",
                Ticket.technician_id.is_(None),
                Ticket.deleted_at.is_(None),
                Ticket.slot_start.is_not(None),
                # Already started is not "at risk", it is missed — and a
                # notification about it would be an apology, not an action.
                Ticket.slot_start > now,
                # This company's own window, not the deployment's.
                Ticket.slot_start
                <= now + _hours(CompanyRules.escalate_hours_before_slot),
                # NULL means never re-notified, which is the common case and
                # must pass — hence the explicit IS NULL rather than relying on
                # a comparison against NULL, which is neither true nor false.
                or_(
                    renotified.is_(None),
                    renotified
                    <= now - _minutes(CompanyRules.renotify_grace_minutes),
                ),
            )
        )
    )

    escalated: list[Ticket] = []
    for row in candidates:
        # `core.escalation` owns the transition, the event, the bell and the
        # doorbells. It lives there rather than here because a cancellation
        # inside this same window escalates too — see its module docstring —
        # and two copies of "escalate" would be two behaviours the day one of
        # them was edited.
        moved = await escalate(
            db,
            row,
            note=(
                f"No technician accepted · {hours_to(row.slot_start)}"
                + (
                    f" · a ₹{row.bonus_paise // 100:,} bonus did not fill it"
                    if row.bonus_paise
                    else ""
                )
            ),
            detail=f"No technician accepted · {row.city} {row.pincode}",
        )
        # False means somebody took it while this sweep was running. That is the
        # system working, not a failure.
        if moved:
            escalated.append(row)

    for row in escalated:
        await whatsapp_the_area_manager(db, row)
    return len(escalated)


async def sweep_silent_slots(db: AsyncSession) -> int:
    """The customer never picked a time.

    Ops asked, WhatsApp delivered, and nothing came back. The ticket cannot
    enter the pool until a slot exists, so it is invisible to every technician
    and will stay that way until somebody phones the customer.

    The vendor is told as well as us: it is their customer who has gone quiet,
    and they are usually the ones with another number to try.
    """
    now = _now()
    asked = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.kind == "slot_requested",
        )
        .scalar_subquery()
    )
    # The company's own threshold comes back WITH the row, because the message
    # quotes it — "has not picked a time in 6h" is the sentence, and reading the
    # number from anywhere but the row that was selected on it is how the text
    # and the query start disagreeing.
    pairs = (
        await db.execute(
            select(Ticket, CompanyRules.slot_silence_hours)
            .join(CompanyRules, CompanyRules.company_id == Ticket.company_id)
            .where(
                Ticket.status == "Slot Pending",
                Ticket.deleted_at.is_(None),
                Ticket.slot_start.is_(None),
                asked.is_not(None),
                asked <= now - _hours(CompanyRules.slot_silence_hours),
                Ticket.id.not_in(_already("slot")),
            )
        )
    ).all()
    rows = [row for row, _ in pairs]
    silence_hours = {row.id: hours for row, hours in pairs}
    return await _raise_for(
        db,
        rows,
        kind="slot",
        title=lambda r: f"{r.code}: no slot chosen yet",
        detail=lambda r: (
            f"{r.customer_name} has not picked a time in {silence_hours[r.id]}h"
        ),
        vendor=True,
    )


async def sweep_force_close(db: AsyncSession) -> int:
    """The technician finished and the customer never answered.

    Only the customer closes a job here, which leaves exactly one hole: a
    customer who says nothing at all. The ticket sits in `Awaiting Customer`
    indefinitely, the technician is not credited, and nothing escalates.

    This does NOT close anything. It puts the ticket in front of a manager who
    can force-close it with supporting documents — the prototype's own closure
    copy promises exactly that, and a system that auto-closed on silence would
    be recording a customer's approval they never gave.
    """
    now = _now()
    asked = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.kind == "feedback_requested",
        )
        .scalar_subquery()
    )
    pairs = (
        await db.execute(
            select(Ticket, CompanyRules.force_close_hours)
            .join(CompanyRules, CompanyRules.company_id == Ticket.company_id)
            .where(
                Ticket.status == "Awaiting Customer",
                Ticket.deleted_at.is_(None),
                Ticket.customer_confirmed_at.is_(None),
                asked.is_not(None),
                asked <= now - _hours(CompanyRules.force_close_hours),
                Ticket.id.not_in(_already("force_close")),
            )
        )
    ).all()
    rows = [row for row, _ in pairs]
    wait_hours = {row.id: hours for row, hours in pairs}
    return await _raise_for(
        db,
        rows,
        kind="force_close",
        title=lambda r: f"{r.code} ready for force closure",
        detail=lambda r: (
            f"No customer response for {wait_hours[r.id]}h · {r.customer_name}"
        ),
    )


async def sweep_slot_reminders(db: AsyncSession) -> int:
    """The technician's slot is about to start.

    The one notification here aimed squarely at preventing a failure rather than
    reporting one. A technician accepted a fixed time the customer chose, and
    the cost of forgetting is a missed appointment, a cancellation band and a
    customer who takes the day off for nothing.

    A push, not a bell: the person who needs it is outdoors with the app shut,
    which is the case the whole push feature exists for.

    ## Idempotency uses a `reminded` EVENT, not the notifications table

    The other three sweeps dedupe against `notifications`, because what they
    raise IS a notification. This one raises nothing a manager should see — a
    routine reminder in an escalation queue is the noise that makes people stop
    reading it. So the marker is a ticket event, which is also the honest place
    for it: "did anybody remind them" is the first question after a no-show, and
    a push receipt is not something this system keeps.
    """
    reminded = select(TicketEvent.ticket_id).where(TicketEvent.kind == "reminded")
    now = _now()
    rows = list(
        await db.scalars(
            select(Ticket)
            .join(CompanyRules, CompanyRules.company_id == Ticket.company_id)
            .where(
                Ticket.status == "Assigned",
                Ticket.deleted_at.is_(None),
                Ticket.technician_id.is_not(None),
                Ticket.slot_start.is_not(None),
                # Never for a slot that has already opened. Late is not a
                # reminder, it is an accusation.
                Ticket.slot_start > now,
                Ticket.slot_start
                <= now + _minutes(CompanyRules.slot_reminder_minutes),
                Ticket.id.not_in(reminded),
            )
        )
    )

    for row in rows:
        db.add(
            TicketEvent(
                company_id=row.company_id,
                ticket_id=row.id,
                kind="reminded",
                actor_kind="system",
                actor_label="Reminder",
                note=f"Reminded the technician — slot at {_slot_clock(row)}",
            )
        )
        # The only sweep that raises no notification still has to ring the
        # ticket's own doorbell. It writes a timeline row, and a manager with
        # that ticket open should watch "Reminded the technician" arrive rather
        # than discover it on the next reload.
        #
        # Before the push, not after: `send_to_technicians` commits when it
        # prunes a dead token, and the notify must be inside whichever commit
        # carries the event — never in a later one that could land alone.
        await publish_ticket_changed(db, row)
        # The event is written whether or not the push lands. A phone with
        # notifications switched off has no token, and recording that we tried
        # is what stops this retrying every five minutes until the slot opens.
        await send_to_technician(
            db,
            company_id=row.company_id,
            technician_id=row.technician_id,
            title=f"{row.code} starts at {_slot_clock(row)}",
            body=f"{row.city} {row.pincode} · {hours_to(row.slot_start)}",
            data={"type": "job", "ticketId": str(row.id), "code": row.code},
        )
    return len(rows)


async def sweep_no_shows(db: AsyncSession) -> int:
    """The slot closed, the technician held it, and they never started.

    The gap this closes is an incentive, not a notification. A technician who
    cancelled ten minutes before a slot was charged the late band; one who
    simply did not turn up and said nothing was charged nothing at all, because
    the `No-show` band had been priced since `company_rules` existed with no way
    on earth to reach it. Silence was the cheapest option available.

    ## What counts as evidence

    `status == 'Assigned'` is the whole test, and it is a strong one. Capturing
    proof is what moves a job to `In Progress`, so a job still sitting in
    `Assigned` after its window closed is one where nobody photographed
    anything on site. Cancelling would have moved it too — back to the pool —
    so the technician did not do that either.

    Measured from `slot_end`, not `slot_start`: while the window is open they
    are late, and late is not the same as absent.

    ## Bounded at BOTH ends

    `NO_SHOW_GRACE_MINUTES` after the close, because proof capture is what
    moves a job to `In Progress` and somebody who reached the door at 11:55 may
    not have photographed the barcode until 12:05. Flagging at the instant the
    window shut would call a technician absent who was standing in the kitchen.

    `NO_SHOW_LOOKBACK_HOURS` before it, for two reasons. It stops the first
    tick after this shipped raising a bell for every historical `Assigned`
    ticket whose slot is in the past — a backlog arriving as one burst, about
    jobs nobody is going to investigate now. And it is the honest boundary
    anyway: charging somebody weeks later for a morning nobody asked them about
    at the time is an ambush rather than a penalty.

    A job that slips past the lookback is not lost, it is simply never charged
    for — it keeps its technician and stays on the ticket list, which is the
    right outcome for a failure nobody noticed in two days.

    ## It NEVER charges

    It raises a notification and stops. A dead phone, a hospital car park and a
    deliberate no-show are indistinguishable from here, and ₹1,200 is far too
    much to take on an inference — so the money waits for a manager to confirm
    it through `service.record_no_show`. That is also why the ticket is left
    exactly where it is: moving it would be acting on the same inference.

    ## They must have HELD the job while the window was open

    A manager can assign somebody to a job whose slot has already closed — that
    button is deliberately still on the missed half of the escalation queue,
    because sending a technician late is better than sending nobody. Without
    this clause the sweep would then accuse the person who agreed to go: handed
    the job at 14:00 for a window that shut at 12:00, and flagged a no-show at
    14:30.

    So the latest `assigned` event has to predate `slot_end`. A ticket with no
    such event at all drops out rather than being flagged — both real paths
    into `Assigned` write one in the same transaction, so its absence means we
    cannot say when they took it, and "we do not know" must never turn into a
    ₹1,200 charge.

    Deduped against the notifications table, like the two sweeps above it —
    what this raises IS a notification, so the record is the marker.
    """
    now = _now()
    # When they were given it. `max`, because a re-assignment writes another.
    assigned_at = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.kind == "assigned",
        )
        .scalar_subquery()
    )
    rows = list(
        await db.scalars(
            select(Ticket).where(
                Ticket.status == "Assigned",
                Ticket.technician_id.is_not(None),
                Ticket.deleted_at.is_(None),
                Ticket.slot_end.is_not(None),
                Ticket.slot_end
                < now - datetime.timedelta(minutes=NO_SHOW_GRACE_MINUTES),
                Ticket.slot_end
                > now - datetime.timedelta(hours=NO_SHOW_LOOKBACK_HOURS),
                # NULL compares to neither, so an event-less ticket drops out —
                # the safe direction when the alternative is a charge.
                assigned_at < Ticket.slot_end,
                Ticket.id.not_in(_already("no_show")),
            )
        )
    )
    return await _raise_for(
        db,
        rows,
        kind="no_show",
        # Reads beside "{code}: no slot chosen yet" and "{code} ready for force
        # closure" — the same shape, and a statement of fact rather than an
        # accusation. Whether it really was a no-show is what the manager is
        # being asked to decide.
        title=lambda r: f"{r.code}: technician did not attend",
        detail=lambda r: (
            f"The slot closed with no proof captured · {r.city} {r.pincode}"
        ),
    )
