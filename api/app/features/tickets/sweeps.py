"""The three notifications that time raises, not people.

Run by `core.scheduler.ticker`. Each returns how many notifications it wrote.

## Idempotency is checked against the notifications table itself

A sweep runs every few minutes and will keep seeing the same overdue ticket
until somebody deals with it. Rather than keeping a separate "already warned"
marker — a column that would have to be reset correctly by every path that
resolves a ticket — each sweep asks whether a notification of that kind already
exists for that ticket. The record IS the marker, so the two cannot disagree.

## Why the timestamps come from `ticket_events`

There is no `slot_requested_at` or `feedback_requested_at` column, and there
should not be: this codebase's rule is that a ticket's history lives in
`ticket_events`, not in its status column. "When did we ask the customer" is a
moment, and the event is where moments are kept.
"""

import datetime
import logging
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.coverage import area_managers_covering
from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.realtime import publish_notification, publish_ticket_changed
from app.models.company import Company
from app.models.notification import Notification
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.integrations import whatsapp


log = logging.getLogger(__name__)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


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


def _hours_to(slot: datetime.datetime | None) -> str:
    if slot is None:
        return "no slot"
    minutes = max(0, int((slot - _now()).total_seconds() // 60))
    return f"{minutes // 60}h {minutes % 60:02d}m to slot"


async def sweep_unaccepted(db: AsyncSession) -> int:
    """Nobody has accepted a job whose slot is close.

    The core operational safety net, and the reason the `escalation` kind was
    defined in the first place. Without it a job simply misses its slot and the
    first anyone hears of it is the customer ringing.

    The window matches the domain's own penalty band: under four hours to the
    slot is the point at which a cancellation escalates to the Area Service
    Manager, so it is the point at which an EMPTY job should reach them too.
    """
    horizon = _now() + datetime.timedelta(hours=settings.ESCALATE_HOURS_BEFORE_SLOT)
    rows = list(
        await db.scalars(
            select(Ticket).where(
                Ticket.status == "New",
                Ticket.technician_id.is_(None),
                Ticket.deleted_at.is_(None),
                Ticket.slot_start.is_not(None),
                # Already started is not "at risk", it is missed — and a
                # notification about it would be an apology, not an action.
                Ticket.slot_start > _now(),
                Ticket.slot_start <= horizon,
                Ticket.id.not_in(_already("escalation")),
            )
        )
    )
    raised = await _raise_for(
        db,
        rows,
        kind="escalation",
        title=lambda r: f"{r.code} unassigned — {_hours_to(r.slot_start)}",
        detail=lambda r: f"No technician accepted · {r.city} {r.pincode}",
    )
    for row in rows:
        await _whatsapp_the_area_manager(db, row)
    return raised


async def _whatsapp_the_area_manager(db: AsyncSession, row: Ticket) -> None:
    """Reach the ASM off the console. The one message this system sends staff.

    A manager has no mobile app, so the bell is a badge they see the next time
    they open a browser tab — no use at nine in the evening for a slot at eight
    tomorrow morning. This is the interruption; the bell remains the record.

    Escalations only, and area managers only. Every rank above them covers
    enough ground that a message per escalation becomes a message they mute,
    and then the one that mattered is lost with the rest.

    Never raises and never blocks the sweep: the notification row is already
    written and committed by the caller, so a WhatsApp that fails costs the
    interruption, not the record.
    """
    try:
        company = await db.scalar(
            select(Company.name).where(Company.id == row.company_id)
        )
        managers = await area_managers_covering(
            db, company_id=row.company_id, pincode=row.pincode
        )
        if not managers:
            # Worth a log line rather than silence: a pincode with no area
            # manager means an escalation nobody is interrupted about, and that
            # is a territory gap somebody should close.
            log.warning(
                "escalation %s: no area manager with a phone covers %s",
                row.code,
                row.pincode,
            )
            return
        for manager in managers:
            await whatsapp.send_escalation(
                manager.phone or "",
                company or "Reliance GreenTech",
                row.code,
                f"{row.city} {row.pincode}",
                _hours_to(row.slot_start),
            )
    except Exception:
        log.exception("escalation %s: could not message the area manager", row.code)


async def sweep_silent_slots(db: AsyncSession) -> int:
    """The customer never picked a time.

    Ops asked, WhatsApp delivered, and nothing came back. The ticket cannot
    enter the pool until a slot exists, so it is invisible to every technician
    and will stay that way until somebody phones the customer.

    The vendor is told as well as us: it is their customer who has gone quiet,
    and they are usually the ones with another number to try.
    """
    cutoff = _now() - datetime.timedelta(hours=settings.SLOT_SILENCE_HOURS)
    asked = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.kind == "slot_requested",
        )
        .scalar_subquery()
    )
    rows = list(
        await db.scalars(
            select(Ticket).where(
                Ticket.status == "Slot Pending",
                Ticket.deleted_at.is_(None),
                Ticket.slot_start.is_(None),
                asked.is_not(None),
                asked <= cutoff,
                Ticket.id.not_in(_already("slot")),
            )
        )
    )
    return await _raise_for(
        db,
        rows,
        kind="slot",
        title=lambda r: f"{r.code}: no slot chosen yet",
        detail=lambda r: (
            f"{r.customer_name} has not picked a time in "
            f"{settings.SLOT_SILENCE_HOURS}h"
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
    cutoff = _now() - datetime.timedelta(hours=settings.FORCE_CLOSE_HOURS)
    asked = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.kind == "feedback_requested",
        )
        .scalar_subquery()
    )
    rows = list(
        await db.scalars(
            select(Ticket).where(
                Ticket.status == "Awaiting Customer",
                Ticket.deleted_at.is_(None),
                Ticket.customer_confirmed_at.is_(None),
                asked.is_not(None),
                asked <= cutoff,
                Ticket.id.not_in(_already("force_close")),
            )
        )
    )
    return await _raise_for(
        db,
        rows,
        kind="force_close",
        title=lambda r: f"{r.code} ready for force closure",
        detail=lambda r: (
            f"No customer response for {settings.FORCE_CLOSE_HOURS}h · "
            f"{r.customer_name}"
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
    horizon = _now() + datetime.timedelta(minutes=settings.SLOT_REMINDER_MINUTES)
    rows = list(
        await db.scalars(
            select(Ticket).where(
                Ticket.status == "Assigned",
                Ticket.deleted_at.is_(None),
                Ticket.technician_id.is_not(None),
                Ticket.slot_start.is_not(None),
                # Never for a slot that has already opened. Late is not a
                # reminder, it is an accusation.
                Ticket.slot_start > _now(),
                Ticket.slot_start <= horizon,
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
                note=f"Reminded the technician — slot at {row.slot_start:%H:%M}",
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
            title=f"{row.code} starts at {row.slot_start:%H:%M}",
            body=f"{row.city} {row.pincode} · {_hours_to(row.slot_start)}",
            data={"type": "job", "ticketId": str(row.id), "code": row.code},
        )
    return len(rows)
