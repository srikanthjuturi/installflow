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
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.notifications import notify
from app.core.realtime import publish_notification
from app.models.notification import Notification
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent


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
        await notify(
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
    return await _raise_for(
        db,
        rows,
        kind="escalation",
        title=lambda r: f"{r.code} unassigned — {_hours_to(r.slot_start)}",
        detail=lambda r: f"No technician accepted · {r.city} {r.pincode}",
    )


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
