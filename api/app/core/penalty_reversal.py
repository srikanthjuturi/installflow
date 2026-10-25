"""Giving a penalty back — one body, two doors.

There are exactly two ways to reverse a penalty, and they must do it exactly
the same way:

  * Door 1 — the ticket page (staff): `POST /tickets/{id}/penalties/{entry_id}/reverse`,
    today's rule (the ticket's AM or anyone senior); since Task 05 a NON-home
    penalty reaches only a company Admin/NH through it.
  * Door 2 — the portal Pool screen (Task 05): `POST /franchise/ledger/{entry_id}/reverse`,
    the franchisee's own admin (F7), chosen from the entry id rather than the
    ticket, because a franchise principal never opens a ticket (F13).

Same checks (a reason said, the profile locked, once only, the partial unique
as the race backstop), the same `reversal` row, the same event, the same push.
So the body lives here in `core/` — a second copy is the copy that drifts, and
`core.ledger` already owns the vocabulary of the rows this writes. Task 11
§4.10 builds on it, which would make three doors — one body has to exist by
then.

**Who may reverse is NOT decided here.** The doors load and authorise their own
row — with `may_reverse` (core.franchise_money) — because "who" differs by door
(territory on Door 1, the franchisee wall on Door 2) while "how" is identical.
This module is the "how".

The `TicketEvent` is built INLINE rather than via `features.tickets.service`.
`record_event` — a function-shaped comment in that slice — lives with the
intake code; `core` importing a feature would be the dependency the repo's
hard rule 4 exists to prevent, and the event is five fields on a row whose
`created_by` is the reversing user, so inlining is the cheaper direction.
"""

import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.ledger import entry as ledger_entry
from app.core.push import send_to_technician
from app.core.push_text import PushText
from app.core.realtime import publish_job_changed, publish_ticket_changed
from app.models.ledger import REVERSIBLE_KINDS, LedgerEntry
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
from app.models.ticket_event import TicketEvent
from app.models.user import User

#: What a reversal may name. MOVED to `app/models.ledger` in Task 11 (one
#: tuple, one home, beside the kinds it names) and re-imported there — the
#: `from app.core.penalty_reversal import REVERSIBLE_KINDS` in
#: `features/ledger/service.py` keeps working, but read it from the model.

def _already_reverse() -> AppError:
    return AppError(
        http_status.HTTP_409_CONFLICT,
        "PENALTY_ALREADY_REVERSED",
        "This penalty has already been reversed. Reload the page to see who "
        "reversed it.",
    )


async def _technician_name(db: AsyncSession, profile: TechnicianProfile) -> str:
    """The person's name, for the trail. Their code if the join comes up empty.

    The same query `tickets.service._technician_name` asks — inlined here for
    the same reason the event is (core does not import features), and kept
    byte-identical so the event note reads exactly as it always has.
    """
    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.id == profile.membership_id)
    )
    return name or profile.code


async def reverse(
    db: AsyncSession,
    *,
    penalty: LedgerEntry,
    ticket,
    reason: str,
    actor_user_id: uuid.UUID,
    actor_label: str | None,
) -> LedgerEntry:
    """Give a penalty back — all of it, once, with a reason.

    ``record_no_show``'s shape, pointed the other way: that one takes a band in
    from a manager's word, this one returns it on a manager's word.

    **What.** A NEW `reversal` row naming the penalty (nothing in the ledger is
    ever edited), for the full amount, copying BOTH of its stamps — the PENALTY's
    `franchisee_id` (the pool that collected it, F12) and its `technician_type`
    (the stream it came from, §4.9) — in case the technician has since moved
    either. Every sum that reads penalties already treats a reversed one as
    never charged: the cap (`charged_this_month`), the pool, and the
    technician's own earnings.

    **Once.** The technician's profile row is locked, as the cancel path locks
    it, so a reversal and a new charge against the same monthly cap cannot
    interleave. A second reversal of the same penalty is a 409 — checked in
    words, and guaranteed by `uq_ledger_entries_reverses` for the race.

    Returns the reversal row, refreshed — the Portal door answers with it.
    """
    text = reason.strip()
    if len(text) < 3:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Say why the penalty is being reversed",
        )

    profile = await db.scalar(
        select(TechnicianProfile).where(
            TechnicianProfile.id == penalty.technician_id,
            TechnicianProfile.company_id == penalty.company_id,
        )
    )
    if profile is None:  # RESTRICT on the FK makes this unreachable today
        raise AppError(http_status.HTTP_404_NOT_FOUND, "NOT_FOUND", "Penalty not found")
    await db.refresh(profile, with_for_update=True)

    already = await db.scalar(
        select(LedgerEntry.id).where(
            LedgerEntry.company_id == penalty.company_id,
            LedgerEntry.reverses_id == penalty.id,
        )
    )
    if already is not None:
        raise _already_reverse()

    amount = penalty.amount_paise
    name = await _technician_name(db, profile)
    # Task 11: a `speed_penalty` is reversed through the SAME door, and the
    # trail has to say which kind came back — a speed penalty is the slow
    # finish's charge, and "penalty" alone would read as a cancellation that
    # never happened. (§4.6; the amounts are quoted here as Task 05 wrote them,
    # on the one event that has always carried them.)
    reversed_word = "speed penalty" if penalty.kind == "speed_penalty" else "penalty"
    reversal = ledger_entry(
        company_id=penalty.company_id,
        technician_id=penalty.technician_id,
        ticket_id=ticket.id,
        kind="reversal",
        amount_paise=amount,
        # The manager's own words — the kind already says it is a reversal.
        reason=text[:160],
        by_user=actor_user_id,
        reverses_id=penalty.id,
        # A reversal gives money back out of the pool that collected the
        # penalty (F12) AND out of the stream of the type that earned it —
        # the PENALTY's stamps, not the technician's current ones.
        franchisee_id=penalty.franchisee_id,
        technician_type=penalty.technician_type,
    )
    db.add(reversal)
    db.add(
        TicketEvent(
            company_id=ticket.company_id,
            ticket_id=ticket.id,
            kind="penalty_reversed",
            actor_kind="staff",
            actor_label=actor_label or "—",
            note=f"₹{amount // 100:,} {reversed_word} to {name} reversed · {text}",
            created_by=actor_user_id,
        )
    )
    await publish_ticket_changed(db, ticket)
    # The technician's Earnings screen refetches on this frame, so the penalty
    # disappears from their phone without a pull-to-refresh.
    await publish_job_changed(
        db,
        company_id=penalty.company_id,
        technician_id=penalty.technician_id,
        ticket_id=ticket.id,
    )
    try:
        await db.commit()
    except IntegrityError:
        # Two managers inside the same instant. The partial unique index kept
        # the money right; this keeps the sentence right.
        await db.rollback()
        raise _already_reverse() from None

    # Outbound, after the commit — a push cannot be rolled back.
    #
    # `type: "job"` WITHOUT a ticket id, deliberately. The app refreshes its
    # earnings on any `job` push it receives, which is the point; but it routes
    # a TAP to `/job/:id` only when an id is present, and the technician who
    # cancelled no longer holds this job, so that screen would 404. With no id
    # the tap simply opens the app.
    await send_to_technician(
        db,
        company_id=penalty.company_id,
        technician_id=penalty.technician_id,
        message=PushText("penalty.reversed", code=ticket.code, amount=f"₹{amount // 100:,}"),
        data={"type": "job"},
    )
    await db.refresh(reversal)
    return reversal