"""Closing a job on the customer's word.

Separate from `tickets/service.py` because that module is the ops surface — 1200
lines about raising, listing and scheduling — and this is one small thing with
an unusual property: it runs with **no principal at all**. Keeping it apart
makes the unauthenticated surface of this codebase something you can read in one
sitting, which is the only way anyone will notice if it grows.
"""

import datetime
import math
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.ledger import entry as ledger_entry, payout_reason
from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.push_text import PushText
from app.core.realtime import (
    publish_job_changed,
    publish_notification,
    publish_ticket_changed,
)
from app.core.tickets import NO_SHOW_GRACE_MINUTES
from app.models.membership import Membership
from app.models.product import ProductModel
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket, TicketProof
from app.models.ticket_event import TicketEvent
from app.models.user import User

#: What we keep of a customer's comment. Long enough for a real complaint,
#: bounded because this is an unauthenticated write.
MAX_COMMENT = 1000


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def load_by_feedback_token(db: AsyncSession, token: str) -> Ticket:
    """The one ticket this token names, or 404.

    Like `load_by_token` for slots, this is a read with no `company_id` filter —
    it cannot have one, because nobody is signed in. The token IS the
    authorisation, which is why it is 256 bits and why the failure message says
    nothing about whether it ever existed.
    """
    row = await db.scalar(
        select(Ticket).where(
            Ticket.feedback_token == token, Ticket.deleted_at.is_(None)
        )
    )
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="This link is not valid",
        )
    return row


async def technician_name(db: AsyncSession, row: Ticket) -> str:
    """Who the customer met. Falls back to a neutral phrase, never to blank."""
    if row.technician_id is None:
        return "Our technician"
    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .join(TechnicianProfile, TechnicianProfile.membership_id == Membership.id)
        .where(TechnicianProfile.id == row.technician_id)
    )
    return name or "Our technician"


async def record_feedback(
    db: AsyncSession,
    token: str,
    *,
    confirmed: bool,
    rating: int | None,
    comment: str,
) -> Ticket:
    """The customer's answer, and the status it produces.

    Two outcomes and they are not symmetrical:

      * **confirmed** → `Closed`. The job is over, and the technician's stats
        move for the first time in this system's life.
      * **not confirmed** → `Escalated`. Deliberately NOT back to the
        technician: the person who said it was finished is the last person who
        should get to try again unsupervised.

    Single use is enforced in the WHERE clause (`customer_confirmed_at IS
    NULL`), not by reading the row first. `confirm_slot` does the read-then-write
    version of this and can let two simultaneous submissions both through; this
    is the same guarded-UPDATE shape `jobs.accept` uses to settle its race.
    """
    row = await load_by_feedback_token(db, token)

    if row.status != "Awaiting Customer":
        # Cancelled underneath them, or already answered. Either way there is
        # nothing here for the customer to decide.
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="This visit is no longer waiting to be confirmed",
        )

    clean = (comment or "").strip()[:MAX_COMMENT] or None
    if rating is not None and not 1 <= rating <= 5:
        rating = None

    was = row.status
    now = _now()
    to_status = "Closed" if confirmed else "Escalated"

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == row.id,
            Ticket.company_id == row.company_id,
            Ticket.status == "Awaiting Customer",
            #: The burn. A second POST finds this non-null and changes nothing.
            Ticket.customer_confirmed_at.is_(None),
        )
        .values(
            status=to_status,
            customer_confirmed_at=now,
            customer_rating=rating,
            customer_feedback=clean,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="This link has already been used",
        )

    label = row.customer_name
    db.add(
        TicketEvent(
            company_id=row.company_id,
            ticket_id=row.id,
            kind="feedback_received",
            actor_kind="customer",
            actor_label=label,
            note=_feedback_note(confirmed, rating, clean),
            from_status=was,
            to_status=to_status,
        )
    )
    if confirmed and row.technician_id is not None:
        # The technician gets paid, and this is the moment: the customer has
        # said the work is done, which is the only thing that settles it.
        #
        # In the SAME transaction as the guarded UPDATE above, exactly as a
        # penalty commits with the cancellation it charges for. A credit that
        # survived a rolled-back closure would pay for work still outstanding.
        #
        # Paid once, and the burn is the UPDATE's own `customer_confirmed_at IS
        # NULL` predicate rather than a second lookup: we only reach here on the
        # read that changed the row, and `Closed` is terminal, so there is no
        # second closure to double-pay. (`complete` needs its `already_paid`
        # check because a bonus is paid at a NON-terminal step that can repeat.)
        model_name = await db.scalar(
            select(ProductModel.name).where(
                ProductModel.company_id == row.company_id,
                ProductModel.id == row.model_id,
            )
        )
        db.add(
            ledger_entry(
                company_id=row.company_id,
                technician_id=row.technician_id,
                ticket_id=row.id,
                kind="payout",
                amount_paise=row.technician_payout_paise,
                reason=payout_reason(
                    service_type=row.service_type, model_name=model_name or "—"
                ),
            )
        )

    if not confirmed:
        db.add(
            TicketEvent(
                company_id=row.company_id,
                ticket_id=row.id,
                kind="reopened",
                actor_kind="customer",
                actor_label=label,
                note="Customer says the work is not finished — needs a manager",
                from_status=was,
                to_status=to_status,
            )
        )

    if row.technician_id is not None:
        # The technician may still be outside the customer's house. Waiting for
        # a poll to notice is the difference between the app telling them and
        # them finding out later — and if the answer was "not done", later is
        # after they have driven away.
        await publish_job_changed(
            db,
            company_id=row.company_id,
            technician_id=row.technician_id,
            ticket_id=row.id,
        )

    # The console and the vendor portal both want to see this land — a closure
    # and an escalation are the two ticket movements anybody is waiting on.
    await publish_ticket_changed(db, row)

    if not confirmed:
        # A refusal used to move the ticket to Escalated, write the event, fire
        # two socket frames and stop. If no console happened to be open at that
        # moment the frames went nowhere and the ticket simply sat there — the
        # one case this entire feedback loop exists to catch, silently dropped.
        #
        # Same transaction as the transition: a bell for a refusal that failed
        # to save would send a manager to a ticket that says the job is fine.
        raised = await notify(
            db,
            company_id=row.company_id,
            kind="escalation",
            title=f"{row.code}: customer says the work is not finished",
            detail=(
                f"{row.customer_name} refused the closure"
                + (f' — "{clean}"' if clean else "")
            ),
            to=f"/tickets/{row.id}",
            ticket_id=row.id,
            pincode=row.pincode,
        )

    await db.commit()

    # After the commit, all of it: these reach a phone and a browser, and
    # neither is worth losing a customer's answer to.
    if not confirmed:
        await publish_notification(
            db,
            company_id=row.company_id,
            pincode=row.pincode,
            notification_id=raised.id,
        )
        await db.commit()

    if row.technician_id is not None:
        # The technician is the other person who has to know, and the app they
        # would read it in is shut — they finished the job and put the phone
        # away. A refusal especially: a manager is about to ring them about it.
        await send_to_technician(
            db,
            company_id=row.company_id,
            technician_id=row.technician_id,
            message=(
                _closed_message(row.code, rating)
                if confirmed
                else PushText("job.refused", code=row.code)
            ),
            data={"type": "job", "ticketId": str(row.id), "code": row.code},
        )

    if confirmed and row.technician_id is not None:
        await refresh_technician_stats(
            db, company_id=row.company_id, technician_id=row.technician_id
        )

    await db.refresh(row)
    return row


def _feedback_note(confirmed: bool, rating: int | None, comment: str | None) -> str:
    parts = ["Confirmed complete" if confirmed else "Reported NOT complete"]
    if rating is not None:
        parts.append(f"{rating}/5")
    if comment:
        parts.append(f"“{comment}”")
    return " · ".join(parts)


async def refresh_technician_stats(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> None:
    """Recompute this technician's rating, completed count and on-time share.

    Recomputed rather than incremented. An average kept by adding to a running
    total drifts the first time a row is corrected or a ticket is soft-deleted,
    and there is no volume here that makes one aggregate per closure expensive.

    These columns existed since the initial migration with **nothing writing
    them**, which is why every technician's profile showed `—`. This is their
    first writer. Null stays null when there is genuinely nothing to say: a
    technician with closed jobs but no ratings gets a count and no score.

    ## On time

    The share of their closed jobs where they ARRIVED no later than
    `NO_SHOW_GRACE_MINUTES` after the slot closed. Early counts: arriving
    before the window is not lateness.

    **Arrival is the live photo's `captured_at`** — the phone's clock at the
    shutter, from the proof set that started the job. Not the `started` event's
    time, which is when the upload reached us: `ProofArtifactIn` says in as many
    words that a technician can be offline for an hour between the two, and the
    sites that do that — basements, plant rooms, dead spots — are the ones
    `location_check_enabled` exists for. Marking them late for the signal would
    be the same unfairness in a different column.

    The phone's clock is a claim, and only one side of it is bounded: never
    later than the server received the photos, so a fast clock cannot make
    somebody late. A clock set BACK can make somebody look on time, and that is
    accepted rather than guessed at — any cut-off would be an invented number
    that brands the genuinely offline technician late again. It is not hidden
    either: the ticket shows the photo's time beside the time work started, and
    a gap of hours between them is exactly what a manager reading it will see.
    (A lower clamp at the assignment was tried and removed: the second rule
    below already means a job was held before its slot closed, so an earlier
    capture could only ever read as on time with or without it.)

    The grace is the no-show sweep's own, on purpose. It is the width of "at the
    door and photographing the barcode", so an arrival that sweep would not call
    absent is one this does not call late.

    A closed job is MEASURED only when all three hold, and is otherwise left
    out of both sides — never counted as late:

    * **It has a slot.** A job accepted before any time was agreed had no
      window to miss.
    * **They held it before the slot closed** — the latest `assigned` event
      predates `slot_end`, the no-show sweep's own test. A manager may send
      somebody to a window that has already shut, because late beats nobody;
      the person who agreed to go is not late for it. No `assigned` event at all
      means we cannot say when they took it, which is the sweep's call too.
    * **They started it after they were given it and after its time was last
      set** — the first `started` event past the latest `assigned`,
      `slot_confirmed` or `rescheduled` (by `seq`). That excludes a start by the
      previous holder of a re-assigned ticket, a force-closure nobody started,
      and a start that a slot was booked onto afterwards.

    Measured against the CURRENT slot, which is exact rather than a shortcut:
    the third rule means no slot change can come after the start being judged.

    Public because force-closure calls it too — see
    `service.force_close_ticket`. It was private while the customer was the
    only one who could end a job.
    """

    assigned = aliased(TicketEvent)
    held_from = (
        select(func.max(assigned.created_at))
        .where(
            assigned.company_id == Ticket.company_id,
            assigned.ticket_id == Ticket.id,
            assigned.kind == "assigned",
        )
        .correlate(Ticket)
        .scalar_subquery()
    )
    # The last moment the job changed hands or changed time. A start is only
    # this technician's, against this window, if it comes after.
    changed = aliased(TicketEvent)
    settled_seq = (
        select(func.coalesce(func.max(changed.seq), 0))
        .where(
            changed.company_id == Ticket.company_id,
            changed.ticket_id == Ticket.id,
            changed.kind.in_(("assigned", "slot_confirmed", "rescheduled")),
        )
        .correlate(Ticket)
        .scalar_subquery()
    )
    closed = (
        select(
            Ticket.id,
            Ticket.company_id,
            Ticket.customer_rating,
            Ticket.slot_end,
            held_from.label("held_from"),
            settled_seq.label("settled_seq"),
        )
        .where(
            Ticket.company_id == company_id,
            Ticket.technician_id == technician_id,
            # Force-Closed counts. The technician did the work; what failed was
            # the customer answering, which is not theirs to fix — crediting
            # only confirmed closures would quietly under-report anybody whose
            # customers go quiet, and they would show as having neither
            # completed nor cancelled the job.
            #
            # The rating average is untouched by this: a force-closed ticket
            # carries no `customer_rating`, and SQL `avg` skips nulls. A
            # technician credited here gains a job, never a score.
            Ticket.status.in_(("Closed", "Force-Closed")),
            Ticket.deleted_at.is_(None),
        )
        .subquery()
    )

    began = aliased(TicketEvent)
    started_at = (
        select(began.created_at)
        .where(
            began.company_id == closed.c.company_id,
            began.ticket_id == closed.c.id,
            began.kind == "started",
            began.seq > closed.c.settled_seq,
        )
        .order_by(began.seq)
        .limit(1)
        .correlate(closed)
        .scalar_subquery()
    )
    jobs = select(closed, started_at.label("started_at")).subquery()

    # That start's live photo. Proof rows and the `started` event commit in one
    # transaction, and `created_at` is the transaction's `now()`, so equality
    # picks out exactly this proof set — a re-assigned ticket carries the
    # previous holder's photos too.
    live = aliased(TicketProof)
    captured_at = (
        select(func.min(live.captured_at))
        .where(
            live.company_id == jobs.c.company_id,
            live.ticket_id == jobs.c.id,
            live.kind == "live",
            live.created_at == jobs.c.started_at,
        )
        .correlate(jobs)
        .scalar_subquery()
    )
    # Never later than the server received it: a phone clock running fast must
    # not make somebody late. `least` skips a NULL, so a proof set with no live
    # row reads as the upload time.
    arrived_at = func.least(jobs.c.started_at, captured_at)
    # NULL compares to nothing, so each missing piece drops the job out.
    measurable = and_(
        jobs.c.slot_end.is_not(None),
        jobs.c.held_from < jobs.c.slot_end,
        jobs.c.started_at.is_not(None),
    )
    grace = datetime.timedelta(minutes=NO_SHOW_GRACE_MINUTES)
    count, average, measured, on_time = (
        await db.execute(
            select(
                func.count(),
                func.avg(jobs.c.customer_rating),
                func.count().filter(measurable),
                func.count().filter(measurable, arrived_at <= jobs.c.slot_end + grace),
            )
        )
    ).one()

    await db.execute(
        update(TechnicianProfile)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
        )
        .values(
            jobs_completed=count,
            rating=round(float(average), 2) if average is not None else None,
            on_time_pct=on_time_percent(on_time, measured),
        )
    )
    await db.commit()


def on_time_percent(on_time: int, measured: int) -> int | None:
    """A whole percentage that never rounds to a claim the jobs do not support.

    Half up, not Python's half-to-even `round` — 1 of 8 is 13%, the answer the
    backfill migration's SQL gives. But pinned inside 1–99 unless every job, or
    none, was on time: 199 of 200 rounds to 100%, and "100%" says they have
    never been late, which one of those 200 says they have. 1 of 200 is not 0%
    for the same reason.
    """
    if not measured:
        return None
    if on_time in (0, measured):
        return 100 if on_time else 0
    return min(99, max(1, math.floor(100 * on_time / measured + 0.5)))


def _closed_message(code: str, rating: int | None) -> PushText:
    """What a technician reads when the customer accepted the work.

    The rating is only mentioned when there is one. "Rated 0 stars" for a
    customer who confirmed without rating would be a fabricated score, and the
    rule everywhere else in this codebase is that a null rating renders as
    nothing rather than as a bad one.
    """
    if rating is None:
        return PushText("job.closed", code=code)
    return PushText("job.closedRated", code=code, rating=rating)
