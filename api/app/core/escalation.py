"""Taking a job out of the pool and putting it in front of a manager.

One definition of "escalate", because there are now two ways to reach it and
§7 treats them as the same outcome:

  * **nobody ever accepted it** and the slot came close — `tickets.sweeps`;
  * **the technician who held it gave it up** inside that same window —
    `jobs.service.cancel`, whose approved screen promises the technician it
    *"escalates straight to the Area Service Manager for urgent
    reassignment"*.

In `core/` because those are two different slices and slices never import each
other (hard rule 4). It sits beside `core.coverage` and `core.scope`, which
were promoted here for exactly the same reason: a rule two slices need is a
rule that must have one copy, or the second one drifts.

The drift this prevents is not cosmetic. A cancellation that escalated without
ringing the bell would be an escalation nobody was told about, and "straight to
the Area Service Manager" would be a sentence the app prints and the server
does not honour.

## It never commits

The caller owns the transaction, because the escalation has to land with
whatever caused it — a release and its ledger entry, or a sweep's whole batch.
`pg_notify` is transactional too, so a rolled-back caller tells nobody
anything.

The WhatsApp is the exception and says so where it happens: it leaves this
process immediately and cannot be rolled back, which is why it is the last
thing done and why it never raises.
"""

import datetime
import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.coverage import area_managers_covering
from app.core.notifications import notify
from app.core.realtime import (
    publish_notification,
    publish_pool_changed,
    publish_ticket_changed,
)
from app.integrations import whatsapp
from app.models.company import Company
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent

log = logging.getLogger(__name__)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def time_to_slot(slot: datetime.datetime | None) -> str:
    """`2h 40m`, or `no slot`. The bare span, with nothing appended.

    Split out from `hours_to` because the two readers need it in different
    grammar. A notification TITLE wants the suffix — "CA-INST-0087 unassigned
    — 2h 40m to slot" — while the WhatsApp template's own sentence supplies
    its own: "the slot is {{4}}". Passing the suffixed form to that produced
    "the slot is 2h 40m to slot", which shipped.
    """
    if slot is None:
        return "no slot"
    minutes = max(0, int((slot - _now()).total_seconds() // 60))
    return f"{minutes // 60}h {minutes % 60:02d}m"


def hours_to(slot: datetime.datetime | None) -> str:
    """`2h 40m to slot`, for a title a manager reads at a glance."""
    span = time_to_slot(slot)
    return span if span == "no slot" else f"{span} to slot"


async def escalate(
    db: AsyncSession,
    row: Ticket,
    *,
    note: str,
    detail: str,
    actor_kind: str = "system",
    actor_label: str = "Escalation",
) -> bool:
    """Move one unassigned ticket to `Escalated`. False if somebody got there first.

    A **guarded UPDATE**, not a read-then-write, and the guard is the whole
    point: the thing racing this is a technician tapping Accept on a card they
    are still looking at. `WHERE status = 'New' AND technician_id IS NULL`
    means the technician wins, the rowcount is 0, and nothing is recorded about
    a job that is no longer empty.

    `New` is the only status it moves from. A cancellation that lands inside the
    window releases the ticket to `New` first and then calls this, rather than
    going straight to `Escalated`, so that the release and the escalation are
    two facts on the trail instead of one that hides the other.

    Returns whether it escalated, so a caller batching many can count them.
    """
    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == row.id,
            Ticket.company_id == row.company_id,
            Ticket.status == "New",
            Ticket.technician_id.is_(None),
        )
        .values(status="Escalated")
    )
    if result.rowcount == 0:
        return False

    # The in-memory row still says `New`, and both the event below and the
    # realtime frame read from it.
    row.status = "Escalated"
    db.add(
        TicketEvent(
            company_id=row.company_id,
            ticket_id=row.id,
            kind="escalated",
            actor_kind=actor_kind,
            actor_label=actor_label,
            from_status="New",
            to_status="Escalated",
            note=note,
        )
    )

    raised = await notify(
        db,
        company_id=row.company_id,
        kind="escalation",
        title=f"{row.code} unassigned — {hours_to(row.slot_start)}",
        detail=detail,
        to=f"/tickets/{row.id}",
        ticket_id=row.id,
        pincode=row.pincode,
    )
    await publish_notification(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        vendor_id=None,
        notification_id=raised.id,
    )
    # It has just LEFT the pool, and every eligible technician is still being
    # shown the card. The same doorbell that announces a new job announces one
    # that is gone.
    await publish_pool_changed(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        node_path_ids=row.node_path_ids,
    )
    await publish_ticket_changed(db, row)
    return True


async def whatsapp_the_area_manager(db: AsyncSession, row: Ticket) -> None:
    """Reach the ASM off the console. The one message this system sends staff.

    A manager has no mobile app, so the bell is a badge they see the next time
    they open a browser tab — no use at nine in the evening for a slot at eight
    tomorrow morning. This is the interruption; the bell remains the record.

    Escalations only, and area managers only. Every rank above them covers
    enough ground that a message per escalation becomes a message they mute,
    and then the one that mattered is lost with the rest.

    Never raises and never blocks its caller: the notification row is the
    record, so a WhatsApp that fails costs the interruption rather than the
    fact. Call it AFTER the commit — it cannot be rolled back.
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
            span = time_to_slot(row.slot_start)
            await whatsapp.send_escalation(
                manager.phone or "",
                company or "Reliance GreenTech",
                row.code,
                f"{row.city} {row.pincode}",
                # The template reads "…and the slot is {{4}}", so this has to
                # complete that sentence rather than repeat the noun.
                "not set" if span == "no slot" else f"in {span}",
            )
    except Exception:
        log.exception("escalation %s: could not message the area manager", row.code)
