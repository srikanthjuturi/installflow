"""Closing a job on the customer's word.

Separate from `tickets/service.py` because that module is the ops surface — 1200
lines about raising, listing and scheduling — and this is one small thing with
an unusual property: it runs with **no principal at all**. Keeping it apart
makes the unauthenticated surface of this codebase something you can read in one
sitting, which is the only way anyone will notice if it grows.
"""

import datetime
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.realtime import (
    publish_job_changed,
    publish_notification,
    publish_ticket_changed,
)
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
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
        await notify(
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
            db, company_id=row.company_id, pincode=row.pincode
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
            title=(
                f"{row.code} closed"
                if confirmed
                else f"{row.code}: the customer says it is not finished"
            ),
            body=(
                _closed_body(rating)
                if confirmed
                else "A manager will be in touch. Do not return to site until they call."
            ),
            data={"type": "job", "ticketId": str(row.id), "code": row.code},
        )

    if confirmed and row.technician_id is not None:
        await _refresh_technician_stats(
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


async def _refresh_technician_stats(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> None:
    """Recompute this technician's rating and completed count from the tickets.

    Recomputed rather than incremented. An average kept by adding to a running
    total drifts the first time a row is corrected or a ticket is soft-deleted,
    and there is no volume here that makes one aggregate per closure expensive.

    These two columns have existed since the initial migration with **nothing
    writing them**, which is why every technician's profile shows `—`. This is
    their first writer. Null stays null when there is genuinely nothing to say:
    a technician with closed jobs but no ratings gets a count and no score.
    """
    closed = (
        select(
            func.count(Ticket.id),
            func.avg(Ticket.customer_rating),
        )
        .where(
            Ticket.company_id == company_id,
            Ticket.technician_id == technician_id,
            Ticket.status == "Closed",
            Ticket.deleted_at.is_(None),
        )
    )
    count, average = (await db.execute(closed)).one()

    await db.execute(
        update(TechnicianProfile)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
        )
        .values(
            jobs_completed=count,
            rating=round(float(average), 2) if average is not None else None,
        )
    )
    await db.commit()


def _closed_body(rating: int | None) -> str:
    """What a technician reads when the customer accepted the work.

    The rating is only mentioned when there is one. "Rated 0 stars" for a
    customer who confirmed without rating would be a fabricated score, and the
    rule everywhere else in this codebase is that a null rating renders as
    nothing rather than as a bad one.
    """
    if rating is None:
        return "The customer confirmed the installation. Nice work."
    return f"The customer confirmed it and rated you {rating}/5."
