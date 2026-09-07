"""Moving a confirmed slot, and telling the customer it moved.

One definition of "reschedule", because there are two doors onto it and they
must not drift:

  * **the technician standing at the address** — `jobs.service.reschedule`,
    which first burns a one-time code the CUSTOMER received, so the move
    carries their consent in a form the server can check;
  * **a manager who has already spoken to them** — `tickets.service.reschedule`,
    which carries no code and a written reason instead.

In `core/` for `core.escalation`'s exact reason: those are two slices and hard
rule 4 forbids them importing each other. A second copy of "move the slot" would
be a second answer to "what status does it land in", and the two would disagree
the first time one was edited.

## What this deliberately does NOT touch

**`sla_due_at`.** The service level's promise — the slot must START within N
hours of the ticket being raised — is a fact about what was agreed at intake,
and re-basing it would erase a breach that really happened. So a rescheduled
ticket goes on reading as breached on the console's board, and the event this
writes is what explains the red row. The replacement window is bounded by
`core.tickets.RESCHEDULE_HORIZON_HOURS` instead; the argument is there.

**`slot_confirmed_at`, once it is set.** Three readers treat that column as "the
customer has burned their slot token": `tickets.slot_page._render`, `_hydrate`'s
`slotLink`, and `confirm_slot`'s own 409. A reschedule never involves the token,
so rewriting it would make the column mean two different things depending on
what last touched the row. The moment the CURRENT slot was agreed is this
event's `created_at`, which is where every other moment in this system lives.

It is still WRITTEN when it was null — but only by the door that has the
customer's own word, which is what `customer_agreed` decides. The column says
"the customer picked this", and the console prints exactly that sentence off it;
a manager booking a time they agreed on the phone has not earned it.

That leaves the manager's door one real hazard, and it closes it differently: a
`Slot Pending` ticket still has a live slot link out there. Ops books at 14:00,
the customer opens this morning's WhatsApp at 14:05, and `confirm_slot` finds
`slot_confirmed_at` null, passes its 409 and overwrites the slot just agreed on
the phone. So that door spends the TOKEN instead of claiming the customer's
consent — same protection, without the lie.

## It never commits

The caller owns the transaction, because the move has to land with whatever
caused it — a burned code and its event, or a manager's reason. `pg_notify` is
transactional too, so a rolled-back caller tells nobody anything.

`send_slot_moved` is the exception and says so where it happens: it leaves this
process immediately and cannot be rolled back.
"""

import datetime
import logging
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notifications import notify
from app.core.realtime import (
    publish_job_changed,
    publish_notification,
    publish_pool_changed,
    publish_ticket_changed,
)
from app.core.slots import when_label
from app.integrations import whatsapp
from app.models.company import Company
from app.models.product import ProductModel
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent

log = logging.getLogger(__name__)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def move_slot(
    db: AsyncSession,
    row: Ticket,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
    actor_kind: str,
    actor_label: str,
    customer_agreed: bool,
    by_user: uuid.UUID | None = None,
    note: str | None = None,
) -> str | None:
    """Write the new window. Returns the new status, or None if somebody raced us.

    A **guarded UPDATE**, not a read-then-write, and the guard carries the
    ticket's whole current shape — status, technician AND the slot it holds —
    rather than just its id. Two managers on the same ticket, or a technician
    and a manager, would otherwise both read the same "before" and both write,
    and the second would silently overwrite a move the first had already told a
    customer about. `rowcount == 0` means the row moved underneath; the caller
    turns that into a 409 telling them to refresh.

    ## The status it lands in

    `"Assigned" if technician_id is not None else "New"` — `confirm_slot`'s own
    rule, verbatim and for its reason. Somebody holding the job keeps it: the
    missing piece was a time and a time has arrived. Nobody holding it means the
    pool should have it, which is what finally clears an `Escalated` ticket
    whose slot had passed — the case `list_escalations` has a ⚠ about.

    ⚠ It is the CALLER's job to refuse `Escalated` with a technician still on
    it. That shape means "the customer said it was not done", not "nobody
    accepted", and this function cannot tell the difference from the row.

    ## Which event it writes

    `rescheduled` when a slot already existed, `slot_confirmed` when one did
    not. The second is not a move at all — it is a first booking a manager typed
    in — and recording it as a reschedule would put a line in the trail saying a
    time changed when none had, and would arm every sweep re-arm in
    `tickets.sweeps` against a slot that never moved.
    """
    # Captured BEFORE the UPDATE. An ORM-enabled UPDATE synchronises the
    # session, so reading these afterwards gives the new values and the trail
    # would record a ticket moving from the state it moved INTO. The same trap
    # `escalate` and `accept` both document.
    was = row.status
    held = row.technician_id
    previous_start, previous_end = row.slot_start, row.slot_end
    first_booking = previous_start is None

    to = "Assigned" if held is not None else "New"

    values: dict[str, object] = {
        "slot_start": start,
        "slot_end": end,
        "status": to,
    }
    # `slot_confirmed_at` means one specific thing — the CUSTOMER themselves
    # agreed this time — and the console reads it that way, printing "Picked by
    # the customer" wherever it is set. So only the door that actually has their
    # word for it may write it, and only when it was null: never rewritten (three
    # readers treat it as "the slot token is spent"), never nulled (that would
    # resurrect a spent token).
    if customer_agreed and row.slot_confirmed_at is None:
        values["slot_confirmed_at"] = _now()
    elif not customer_agreed and row.slot_confirmed_at is None and row.slot_token:
        # A manager booking a ticket whose customer still holds a live slot
        # link. We cannot claim they picked it, so the column stays null — but
        # then nothing stops them opening that link five minutes later and
        # choosing a different window over the one just agreed on the phone
        # (`confirm_slot` only refuses once `slot_confirmed_at` is set).
        #
        # Spending the token closes it. The link answers "this link is not
        # valid", which is true: the visit it was asking about is booked, and
        # the confirmation WhatsApp says what to.
        values["slot_token"] = None

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == row.id,
            Ticket.company_id == row.company_id,
            Ticket.status == was,
            Ticket.technician_id.is_(None)
            if held is None
            else Ticket.technician_id == held,
            Ticket.slot_start.is_(None)
            if first_booking
            else Ticket.slot_start == previous_start,
        )
        .values(**values)
    )
    if result.rowcount == 0:
        return None

    row.status = to
    row.slot_start, row.slot_end = start, end
    if "slot_confirmed_at" in values:
        row.slot_confirmed_at = values["slot_confirmed_at"]  # type: ignore[assignment]
    if "slot_token" in values:
        row.slot_token = None

    moved = when_label(start, end)
    # Both windows, old first. The ticket keeps only the current one, so without
    # this the trail would record that something changed and not what — and
    # "what time was it before" is the first thing anybody asks.
    trail = (
        moved
        if first_booking
        else f"{when_label(previous_start, previous_end)} → {moved}"
    )
    db.add(
        TicketEvent(
            company_id=row.company_id,
            ticket_id=row.id,
            kind="slot_confirmed" if first_booking else "rescheduled",
            actor_kind=actor_kind,
            actor_label=actor_label,
            created_by=by_user,
            note=trail if not note else f"{trail} · {note}",
            from_status=was,
            # Both null when nothing moved — an `Assigned` job rescheduled by
            # its own technician is still `Assigned`, and a trail claiming a
            # transition that did not happen is worse than one that says
            # nothing about it.
            to_status=None if to == was else to,
        )
    )

    await publish_ticket_changed(db, row)
    if held is not None:
        await publish_job_changed(
            db,
            company_id=row.company_id,
            technician_id=held,
            ticket_id=row.id,
        )
    else:
        # It is in the pool, and the pool changed. Note this is a real re-entry
        # rather than a formality: `pool_query` stops offering a slotted job
        # once its window opens, so a `New` ticket whose slot had passed was
        # invisible to every technician until this moment.
        await publish_pool_changed(
            db,
            company_id=row.company_id,
            pincode=row.pincode,
            node_path_ids=row.node_path_ids,
        )
    return to


async def announce(
    db: AsyncSession,
    row: Ticket,
    *,
    previous: tuple[datetime.datetime | None, datetime.datetime | None],
    by: str,
) -> None:
    """Ring the bell for a moved slot. Never commits.

    **Carries `vendor_id`, and that is the reason it exists.** Every other party
    already learns about a reschedule: the customer gets a WhatsApp, the
    technician gets a push and their app refetches, the console's ticket stream
    redraws. The vendor — who asked for the visit, and whose customer is now
    expecting somebody on a different day — learned nothing at all.

    Scoped by `pincode` as well, so the area manager over that ground sees it
    too. A slot moving is not the routine courtesy `reminded` is: it changes a
    commitment somebody made, and the two sweeps that deliberately raise no bell
    are the counter-example, not the precedent.
    """
    when = when_label(row.slot_start, row.slot_end) if row.slot_start else "a new time"
    was = (
        when_label(previous[0], previous[1])
        if previous[0] and previous[1]
        else None
    )
    raised = await notify(
        db,
        company_id=row.company_id,
        kind="rescheduled",
        title=f"{row.code} moved to {when}",
        detail=(
            f"Was {was} · rescheduled by {by}" if was else f"Slot set by {by}"
        ),
        to=f"/tickets/{row.id}",
        ticket_id=row.id,
        pincode=row.pincode,
        vendor_id=row.vendor_id,
    )
    await publish_notification(
        db,
        company_id=row.company_id,
        pincode=row.pincode,
        vendor_id=row.vendor_id,
        notification_id=raised.id,
    )


async def send_slot_moved(
    db: AsyncSession,
    row: Ticket,
    previous: tuple[datetime.datetime, datetime.datetime] | None,
) -> TicketEvent | None:
    """Tell the customer their visit moved. Returns the event; never raises.

    Deliberately NOT `send_slot_confirmed`. A customer already holding "your
    visit is confirmed for Tue 2:00–4:00 PM" who then receives the same sentence
    naming Thursday has two messages in identical words and no way to tell which
    is current — and the one they act on is as likely to be the older. Naming
    what it WAS is what makes this read as a correction.

    Returns the `confirmation_sent` event recording the OUTCOME, for the caller
    to add, exactly as `tickets.service._send_slot_confirmed` does: a booking
    can be real while the message about it never arrived, and that difference is
    what somebody asking "why did my customer turn up on Tuesday" needs to see.

    Call it AFTER the commit — it leaves this process and cannot be rolled back.

    ⚠ `previous` must be a slot that really existed. A FIRST booking has none,
    and its receipt is `send_slot_confirmed` — there is nothing to correct, and
    "it was X, it is now Y" cannot be written without an X. The tuple is
    unpacked below, so `(None, None)` is checked for as carefully as `None`
    itself: it is what a caller reading `(row.slot_start, row.slot_end)` off an
    unbooked ticket holds, and it is not the same value as `None`.
    """
    if row.slot_start is None or row.slot_end is None:
        return None
    if previous is None or previous[0] is None or previous[1] is None:
        return None

    company = (
        await db.scalar(select(Company.name).where(Company.id == row.company_id))
    ) or "Reliance GreenTech Service"
    model_name = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    result = await whatsapp.send_slot_rescheduled(
        row.customer_phone,
        company,
        model_name or "your product",
        when_label(*previous),
        when_label(row.slot_start, row.slot_end),
    )
    return TicketEvent(
        company_id=row.company_id,
        ticket_id=row.id,
        kind="confirmation_sent",
        actor_kind="system",
        actor_label="WhatsApp",
        note=(
            f"Reschedule sent to {row.customer_phone}"
            if result.ok
            else f"Could not send: {result.error or 'unknown error'}"
        ),
    )
