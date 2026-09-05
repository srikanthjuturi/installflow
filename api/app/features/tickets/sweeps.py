"""The things time raises, not people.

Run by `core.scheduler.ticker`. Each returns how many notifications it wrote.

Six of them now, and two are different in kind. `sweep_no_shows` reports a
FAILURE that has already happened rather than a risk that still can be
prevented; it deliberately changes nothing and charges nothing — see its own
note on why a clock must not be allowed to fine anybody. And two of the six —
`sweep_slot_reminders` and `sweep_customer_notice` — raise no notification at
all: they send a message to the person who needs it, technician and customer
respectively, and record having done so on the ticket. A routine courtesy in an
escalation queue is the noise that makes people stop reading it.

## Idempotency is checked against whatever the sweep already changed

A sweep runs every few minutes and will keep seeing the same overdue ticket
until somebody deals with it. Rather than keeping a separate "already warned"
marker — a column that would have to be reset correctly by every path that
resolves a ticket — each sweep asks whether the thing it does has already been
done. The record IS the marker, so the two cannot disagree.

For the three that only raise a notification, that record is the notification
(`_already`). For the rest it is the change: an escalation is settled by a
guarded UPDATE off `status = 'New'`, a slot reminder by a `reminded` event, and
a customer notice by a `customer_notified` one. The escalation's is the
strongest form, because it also settles the race against whatever else is
moving the same ticket.

## Why the timestamps come from `ticket_events`

There is no `slot_requested_at` or `feedback_requested_at` column, and there
should not be: this codebase's rule is that a ticket's history lives in
`ticket_events`, not in its status column. "When did we ask the customer" is a
moment, and the event is where moments are kept.

## Every window is the TICKET'S OWN

These sweeps run across the whole database at once — one tick, every tenant —
so the thresholds cannot be Python constants folded into a `timedelta` before
the query. They were exactly that until `company_rules` existed, which is how a
multi-tenant product ended up with one escalation window for the entire
deployment.

They then JOINed `company_rules`. They no longer join anything: a ticket
**stamps its resolved rules at intake**, so every threshold is a value on the
row already being scanned. `INTERVAL '1 hour' * <expression>` is the Postgres
spelling; multiplying an interval by an integer is exact, and it keeps the
comparison on the indexed `slot_start` rather than wrapping it in a function.

Two things that bought:

* **Per PRODUCT, not just per tenant.** A category may override any of these
  windows, and a sweep reading the ticket gets that for free — there was no
  join that could have expressed "this company's rules, unless this ticket's
  category says otherwise, unless one of its ancestors does".
* **The INNER-join hazard is gone.** A company with no rules row used to drop
  silently out of every sweep, and a missed escalation looks like nothing at
  all. Nothing can drop out now; a ticket cannot exist without a snapshot.

⚠ Read the snapshot through `core.rules.snapshot_int`, never with a bare
`->>`. It supplies the `DEFAULTS` fallback, so a ticket stamped before a rule
existed still sweeps instead of comparing against NULL — which is neither true
nor false, and would quietly exclude the row for ever.
"""

import datetime
import logging
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.escalation import escalate, hours_to, whatsapp_the_area_manager
from app.core.rules import (
    interval_hours as _hours,
    interval_minutes as _minutes,
    snapshot_int,
)
from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.realtime import publish_notification, publish_ticket_changed
from app.core.tickets import NO_SHOW_GRACE_MINUTES, NO_SHOW_LOOKBACK_HOURS
from app.features.tickets.service import clock, when_label
from app.integrations import whatsapp
from app.models.company import Company
from app.models.membership import Membership
from app.models.notification import Notification
from app.models.product import ProductModel
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.models.user import User


log = logging.getLogger(__name__)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


#: A rule out of the ticket's own snapshot, with the `DEFAULTS` fallback.
def _rule(key: str):
    return snapshot_int(Ticket.rules_snapshot, key)


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
                <= now + _hours(_rule("escalate_hours_before_slot")),
                # NULL means never re-notified, which is the common case and
                # must pass — hence the explicit IS NULL rather than relying on
                # a comparison against NULL, which is neither true nor false.
                or_(
                    renotified.is_(None),
                    renotified
                    <= now - _minutes(_rule("renotify_grace_minutes")),
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
    # The threshold comes back WITH the row, because the message quotes it —
    # "has not picked a time in 6h" is the sentence, and reading the number from
    # anywhere but the row that was selected on it is how the text and the query
    # start disagreeing. It is per TICKET now, so two tickets in one sweep can
    # legitimately quote different numbers.
    pairs = (
        await db.execute(
            select(Ticket, _rule("slot_silence_hours"))
            .where(
                Ticket.status == "Slot Pending",
                Ticket.deleted_at.is_(None),
                Ticket.slot_start.is_(None),
                asked.is_not(None),
                asked <= now - _hours(_rule("slot_silence_hours")),
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
            select(Ticket, _rule("force_close_hours"))
            .where(
                Ticket.status == "Awaiting Customer",
                Ticket.deleted_at.is_(None),
                Ticket.customer_confirmed_at.is_(None),
                asked.is_not(None),
                asked <= now - _hours(_rule("force_close_hours")),
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
            .where(
                Ticket.status == "Assigned",
                Ticket.deleted_at.is_(None),
                Ticket.technician_id.is_not(None),
                Ticket.slot_start.is_not(None),
                # Never for a slot that has already opened. Late is not a
                # reminder, it is an accusation.
                Ticket.slot_start > now,
                Ticket.slot_start
                <= now + _minutes(_rule("slot_reminder_minutes")),
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


async def sweep_customer_notice(db: AsyncSession) -> int:
    """Tell the customer who is coming, and on what number to reach them.

    The counterpart to `sweep_slot_reminders`, pointed the other way. That one
    stops the technician forgetting; this one stops the customer being
    surprised — until it existed, the last thing anybody told them was "your
    time is booked", possibly two days earlier, and the next was a stranger at
    the door introducing himself.

    It also gives the customer a number that is not ours. A five-minute delay
    they can hear about directly is a five-minute delay; the same delay with
    nobody to ring becomes a call to the vendor, then a complaint, and
    occasionally a slot that gets cancelled from the other end.

    ## `Assigned` only, and only while the slot is still ahead

    `In Progress` means proof has already been captured, so the technician is
    at the door and a message announcing him is a message about the past. And a
    notice sent after the slot opened tells somebody who is already waiting
    something they worked out themselves.

    ## Idempotency is a `customer_notified` EVENT

    Same reasoning as the slot reminder's `reminded`, and the same refusal to
    raise a notification: a routine courtesy in an escalation queue is the
    noise that stops people reading it. The event is also the honest place for
    it — "did we tell the customer who was coming" is asked after a complaint,
    and a WhatsApp receipt is not something this system keeps.

    The event is written whether or not Meta accepted, with the outcome in
    `note`. A failure that left no row would be retried every tick until the
    slot opened, and would leave the one question somebody asks later
    unanswerable.
    """
    notified = select(TicketEvent.ticket_id).where(
        TicketEvent.kind == "customer_notified"
    )
    now = _now()
    # Everything the message needs, in one query rather than five lookups a
    # row: the company (one WABA sends for every tenant), the product (a
    # customer may have more than one thing on order), and the technician's
    # name and number, which live on `users` — a technician profile carries
    # neither, because the person is the user and the profile is the role.
    #
    # Every join is scoped on `company_id` as well as the id. The composite
    # foreign keys already make a cross-tenant row impossible; saying so in the
    # query is what keeps it impossible after somebody edits this.
    rows = (
        await db.execute(
            select(Ticket, User.full_name, User.phone, Company.name, ProductModel.name)
            .join(Company, Company.id == Ticket.company_id)
            .join(
                ProductModel,
                (ProductModel.id == Ticket.model_id)
                & (ProductModel.company_id == Ticket.company_id),
            )
            .join(
                TechnicianProfile,
                (TechnicianProfile.id == Ticket.technician_id)
                & (TechnicianProfile.company_id == Ticket.company_id),
            )
            .join(
                Membership,
                (Membership.id == TechnicianProfile.membership_id)
                & (Membership.company_id == Ticket.company_id),
            )
            .join(User, User.id == Membership.user_id)
            .where(
                Ticket.status == "Assigned",
                Ticket.deleted_at.is_(None),
                Ticket.technician_id.is_not(None),
                Ticket.slot_start.is_not(None),
                Ticket.slot_end.is_not(None),
                Ticket.slot_start > now,
                Ticket.slot_start
                <= now + _minutes(_rule("customer_notice_minutes")),
                Ticket.id.not_in(notified),
            )
        )
    ).all()

    for row, technician, mobile, company, product in rows:
        # The send comes BEFORE the event here, unlike the slot reminder above,
        # because the event records what Meta said and cannot be written until
        # it has said it. Same order as `tickets.service._send_slot_confirmed`,
        # and the same trade: a crash between the two re-sends the courtesy on
        # the next tick, which is a duplicate message rather than a lost one.
        if not mobile:
            # A technician's phone IS their credential — they sign in by OTP —
            # so this is close to unreachable. It is handled rather than
            # asserted because the alternative is an empty template parameter,
            # which Meta rejects outright, and a message reading "you can reach
            # them on ." if it ever got through. The event still goes in, so
            # the ticket says why nobody was told and the sweep does not retry
            # this every tick until the slot opens.
            note = f"Not sent — {technician or 'the technician'} has no phone number"
        else:
            result = await whatsapp.send_technician_details(
                row.customer_phone,
                company or "Reliance GreenTech Service",
                product or "your product",
                when_label(row.slot_start, row.slot_end),
                # A user row with no name is one nobody completed. Saying "our
                # technician" is thin; sending "None will be attending" is
                # worse, and that is the only other option.
                technician or "Our technician",
                mobile,
            )
            note = (
                f"Sent {row.customer_name} the technician's details"
                if result.ok
                else f"Could not send: {result.error or 'unknown error'}"
            )

        db.add(
            TicketEvent(
                company_id=row.company_id,
                ticket_id=row.id,
                kind="customer_notified",
                actor_kind="system",
                actor_label="WhatsApp",
                note=note,
            )
        )
        # A manager with this ticket open should watch the row arrive rather
        # than find it on the next reload.
        await publish_ticket_changed(db, row)
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
