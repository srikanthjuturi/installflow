"""Measuring a job's speed at closure and writing the money it produces.

Task 11 (S5). This module is the SPEED-CLOSURE WRITER: it runs inside the
customer's closure transaction (`feedback_service.record_feedback`), after the
guarded UPDATE that burned the feedback token and after the payout and travel
rows were added, and before the commit — never after (`refresh_technician_stats`
commits on its own, so a settlement ordered there would be a second
transaction a rollback could no longer undo).

The parts and who owns them:

  * `core.speed` — the PURE half: the clock fold (`clock_from_events`), the
    outcome (`speed_outcome`). Unit-tested without a database. Nothing in this
    module measures a duration itself.
  * `core.accept_snapshot.speed_of` — the FROZEN terms (S5). Read through
    `speed_of` always, never `snapshot["speed"][…]` (§8's trap): a hand-patched
    or pre-Task-11 snapshot must degrade to "no rule", not to a `KeyError`.
  * this file — the DB half: one read of the ticket's events, the profile
    lock, the two possible ledger rows and the one event.

## The lock and its order (§8)

The technician's profile row is locked with the cancel path's
`with_for_update` AFTER the closure's guarded UPDATE on `tickets`, so a speed
penalty and a cancellation charge against the same monthly cap cannot
interleave (W8). The two writers touch different tickets (a closed ticket
cannot be cancelled), so no deadlock cycle forms — and this module therefore
writes NO second update to the ticket row after taking the lock. The only
thing it writes afterwards is the event and the ledger row.

## What is NOT paid here

* Nothing on a FORCE-CLOSURE — `tickets.service.force_close_ticket` never
  calls this (S5, settled by the owner 2026-10-15 as R7); the closure's
  `speed.outcome` on ticket detail reads `"force_closed"`.
* Nothing when the frozen terms are absent (W1: an empty matrix stamped
  `speed: None`), when the snapshot names a DIFFERENT technician than the
  ticket's current holder, or when events cannot produce a clock (no
  `completed`, or no `assigned` before it). Silence IS the record in the
  first three; §4.5's third case writes no event either.
"""

import datetime
import logging
import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.accept_snapshot import speed_of
from app.core.ledger import (
    cap_remaining,
    capped_charge,
    charged_this_month,
    entry as ledger_entry,
)
from app.core.rules import load_rules
from app.core.slots import IST, clock
from app.core.speed import (
    EventFact,
    SpeedClock,
    SpeedTerms,
    clock_from_events,
    hours_label,
    speed_outcome,
)
from app.models.ledger import SPEED_KINDS, LedgerEntry
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpeedSettlement:
    """What the closure decided, for the caller and the ticket detail's own
    re-derivation to agree with.

    `amount_paise` is the amount MOVEMENT (0 when nothing moved — a reward of
    ₹0, a penalty the cap swallowed, or an outcome of "between"); `capped` is
    true when a penalty was reduced or skipped by the monthly cap; `ledger_row`
    is the row when — and only when — one was written.
    """

    outcome: Literal["reward", "penalty", "none"]
    amount_paise: int
    capped: bool
    ledger_row: LedgerEntry | None


async def load_clock(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    ticket_id: uuid.UUID,
    slot_start: datetime.datetime | None,
) -> SpeedClock | None:
    """The clock from `ticket_events`, folded by the pure half (S3).

    One read on `ix_ticket_events_company_ticket (company_id, ticket_id, seq)`,
    filtered to only the rows the fold reads — the two kinds of instant plus
    whatever moved the ticket INTO or OUT of `Awaiting Part` (W6: matched on
    the STATUS columns, so Task 12's `part_requested` kinds work with no change
    here). `slot_start` is `ticket.slot_start` (R1, W17): the caller already
    holds the row, and the ticket's column is the slot IN FORCE at completion.

    Ordered by `seq`, never `created_at` — two events in one transaction share
    `now()`, and `seq` is assigned at INSERT (the same reason
    `refresh_technician_stats` sorts on it). None when the events cannot
    produce a pair of instants at all.
    """
    rows = await db.execute(
        select(
            TicketEvent.seq,
            TicketEvent.kind,
            TicketEvent.created_at,
            TicketEvent.from_status,
            TicketEvent.to_status,
        )
        .where(
            TicketEvent.company_id == company_id,
            TicketEvent.ticket_id == ticket_id,
            or_(
                TicketEvent.kind.in_(("assigned", "completed")),
                TicketEvent.from_status == "Awaiting Part",
                TicketEvent.to_status == "Awaiting Part",
            ),
        )
        .order_by(TicketEvent.seq)
    )
    facts = [EventFact(*r) for r in rows]
    return clock_from_events(facts, slot_start=slot_start)


async def settle_speed(
    db: AsyncSession, ticket: Ticket, *, now=None
) -> SpeedSettlement | None:
    """Measure the job against the frozen terms and write what it produces.

    Returns None whenever nothing was written and there is no honest
    measurement to record (no frozen terms, a mismatched snapshot, no clock,
    or a second call after a settlement already landed). W9's partial unique
    is the structural backstop for a race; that read is the polite version.

    `now` is accepted for signature symmetry with the closure writer and
    carried nowhere today: the clock reads INSTANTS off `ticket_events`
    (`created_at`, the transactions' own `now()`), and the cap's month
    boundary is taken inside `charged_this_month` from the same clock.
    """
    # ── 1. The frozen terms (S5) ─────────────────────────────────────────────
    terms: SpeedTerms | None = speed_of(ticket.accept_snapshot)
    if terms is None:
        # No rule was configured when they accepted (W1), or the ticket predates
        # this task. Nothing was promised, so nothing is measured and nothing
        # is said — the ledger's and the timeline's silence IS the fact.
        return None

    if terms.matched_on not in ("model", "node"):  # pragma: no cover — typed above
        return None

    # A stale stamp must never pay the wrong person: `speed_of` is frozen, but
    # the CLOSURE pays the CURRENT holder, and every path that changes the
    # holder re-stamps or clears (§4.3). A mismatch means a path was missed —
    # logged so it is findable, paid to nobody, exactly as travel does.
    if str(ticket.technician_id) != str(
        (ticket.accept_snapshot or {}).get("technicianId")
    ):
        _log.warning(
            "accept_snapshot names %s but ticket %s is held by %s at closure",
            (ticket.accept_snapshot or {}).get("technicianId"),
            ticket.id,
            ticket.technician_id,
        )
        return None

    # ── 2. The clock (S3/R1), from events the closure transaction can see ────
    clock_data = await load_clock(
        db,
        company_id=ticket.company_id,
        ticket_id=ticket.id,
        slot_start=ticket.slot_start,
    )
    if clock_data is None:
        # Not measurable — no `completed` event, or no `assigned` before it
        # (a force-close's shape, or a legacy ticket). Nothing was measured;
        # §4.5 writes no event for this, for the same reason step 1 stays quiet.
        return None

    outcome, amount = speed_outcome(clock_data.working_hours, terms)

    # The one-time read (W9's polite half). After the closure UPDATE, only one
    # caller can be here — but a retried closure must not double-write, and the
    # partial unique would turn that mistake into a 500.
    already_paid = await db.scalar(
        select(LedgerEntry.id).where(
            LedgerEntry.company_id == ticket.company_id,
            LedgerEntry.ticket_id == ticket.id,
            LedgerEntry.kind.in_(SPEED_KINDS),
        )
    )
    if already_paid is not None:
        _log.warning("ticket %s already carries a speed ledger row", ticket.id)
        return None

    # ── 3. The technician's row, LOCKED (W8) ─────────────────────────────────
    #
    # Loaded company-scoped, then locked — AFTER the closure's guarded UPDATE
    # on the ticket (§8's lock order) and before anything downstream is
    # written. A speed penalty and a cancellation charge against the same
    # monthly cap are serialised on this lock.
    profile = await db.scalar(
        select(TechnicianProfile).where(
            TechnicianProfile.company_id == ticket.company_id,
            TechnicianProfile.id == ticket.technician_id,
        )
    )
    if profile is None:  # RESTRICT on the ledger FK makes this unreachable
        _log.warning(
            "no technician profile for %s at ticket %s closure",
            ticket.technician_id, ticket.id,
        )
        return None
    await db.refresh(profile, with_for_update=True)

    settlement = SpeedSettlement(
        outcome=outcome or "none", amount_paise=0, capped=False, ledger_row=None
    )
    if outcome == "reward" and amount > 0:
        # W7: paid in full, even when the pool is low or negative — an
        # escalation bonus is written with no balance check today, and slow
        # technicians fund fast ones only if the pay is not held hostage to
        # their own charges. (A reward of ₹0 — W2 — writes no row, but the
        # settled outcome is still named below. The cap never touches a
        # reward: W7 is a rate, not a rate under a ceiling.)
        settlement = await _pay_reward(db, ticket, profile, terms, clock_data, amount)
    elif outcome == "penalty":
        settlement = await _charge_penalty(
            db, ticket, profile, terms, clock_data, amount
        )

    # The event records the MEASUREMENT (W12), whenever a frozen rule was
    # measured — including "between", a ₹0 amount and "the cap swallowed it":
    # the audit question "why did nothing happen?" is otherwise unanswerable.
    db.add(
        TicketEvent(
            company_id=ticket.company_id,
            ticket_id=ticket.id,
            kind="speed_settled",
            actor_kind="system",
            note=_event_note(clock_data, outcome, terms, settlement),
            # `created_by` stays null: no principal exists on this route, the
            # same as the payout's (§4.5 step 7).
            created_by=None,
        )
    )

    await db.flush()   # hard rule 10 — the caller's commit, not ours
    return settlement


# ── the two writers ──────────────────────────────────────────────────────────


async def _pay_reward(
    db: AsyncSession, ticket: Ticket, profile: TechnicianProfile,
    terms: SpeedTerms, clock_data: SpeedClock, amount: int,
) -> SpeedSettlement:
    """One `speed_reward` row, out of the pool, with no balance check (W7)."""
    row = ledger_entry(
        company_id=ticket.company_id,
        technician_id=ticket.technician_id,
        ticket_id=ticket.id,
        kind="speed_reward",
        amount_paise=amount,
        reason=(
            f"Speed reward · finished in {hours_label(clock_data.working_hours)} h "
            f"(within {terms.reward_within_hours} h)"
        )[:160],
        # Stamped from the PROFILE row we hold, not left to `entry`'s default
        # subquery: after a flush a defaulted pair is EXPIRED, and reading it in
        # async code raises `MissingGreenlet` (`core.ledger.entry`'s warning).
        # Also the pool the money moves (§3.2) and the stream (§4.9) are the
        # ones the settlement knows, not whatever the profile says by the time
        # a deferred subquery runs.
        franchisee_id=profile.franchisee_id,
        technician_type=profile.technician_type,
        by_user=None,      # no principal on this route, as the payout's
    )
    db.add(row)
    return SpeedSettlement(
        outcome="reward", amount_paise=amount, capped=False, ledger_row=row
    )


async def _charge_penalty(
    db: AsyncSession, ticket: Ticket, profile: TechnicianProfile,
    terms: SpeedTerms, clock_data: SpeedClock, amount: int,
) -> SpeedSettlement:
    """A `speed_penalty` row, capped by the month's remaining headroom (W8).

    The CAP is the company's even though the matrix is the franchisee's (S6) —
    `company_rules.cancel_penalty_cap_paise`, read here rather than argued from
    the pool. `charged_this_month` counts BOTH capped kinds (§4.7), so a
    cancellation already charged this month eats this penalty's headroom and
    the cancellation preview sees this one.
    """
    rules = await load_rules(db, ticket.company_id)
    already = await charged_this_month(
        db,
        company_id=ticket.company_id,
        technician_id=ticket.technician_id,
    )
    remaining = cap_remaining(
        cap_paise=int(
            getattr(rules, "cancel_penalty_cap_paise", 0) or 0
        ),
        already_charged=already,
    )
    charge = capped_charge(amount, remaining)
    if amount == 0:
        # W2: the rule charges nothing — an outcome with no money and no cap
        # involved. Named in the event, but not "capped": nothing was taken
        # away, the cap's headroom was never in question.
        return SpeedSettlement(
            outcome="penalty", amount_paise=0, capped=False, ledger_row=None
        )
    capped = charge < amount
    if charge <= 0:
        # The cap swallowed it. No row (W8): `amount_paise > 0` is a table
        # CHECK, and the absence of a movement is spelled "no row".
        return SpeedSettlement(
            outcome="penalty", amount_paise=0, capped=True, ledger_row=None
        )
    reason = (
        f"Speed penalty · took {hours_label(clock_data.working_hours)} h "
        f"(over {terms.penalty_after_hours} h)"
    )
    if capped:
        reason = f"{reason} · capped at the monthly limit"
    row = ledger_entry(
        company_id=ticket.company_id,
        technician_id=ticket.technician_id,
        ticket_id=ticket.id,
        kind="speed_penalty",
        amount_paise=charge,
        reason=reason[:160],
        franchisee_id=profile.franchisee_id,
        technician_type=profile.technician_type,
        by_user=None,
    )
    db.add(row)
    return SpeedSettlement(
        outcome="penalty", amount_paise=charge, capped=capped, ledger_row=row
    )


# ── the note (§4.5's table, verbatim) ────────────────────────────────────────


def _event_note(
    clock_data: SpeedClock,
    outcome: Literal["reward", "penalty"] | None,
    terms: SpeedTerms,
    settlement: SpeedSettlement,
) -> str:
    """The `speed_settled` event's note — §4.5's copy, no rupee amounts (W12).

    A vendor reads every timeline (R8), so the figures here say how long the
    job took and which band it fell in, and never what the outcome was worth:
    the amounts live on the ticket detail's `speed` block and on the ledger
    rows, both read by people who are party to them.

    The band quotes the FROZEN thresholds, which is what a rule edited later
    cannot restate; the outcome's WORDED distinction between "the rule
    charged" and "the cap reduced/refused the charge" comes from the
    settlement, which is the only place the two are known apart.
    """
    working = hours_label(clock_data.working_hours)
    # A penalty is worded as "Took" — the job went over; a reward and the
    # neither-band are worded as "Finished in", as §4.5's table writes them.
    verb = "Took" if outcome == "penalty" else "Finished in"
    if clock_data.part_wait_hours > 0:
        head = (
            f"{verb} {working} working hours "
            f"({hours_label(clock_data.elapsed_hours)} h since the clock started, "
            f"{hours_label(clock_data.part_wait_hours)} h waiting for parts)"
        )
    else:
        head = f"{verb} {working} working hours"

    paid = settlement.amount_paise
    if outcome == "reward" and terms.reward_paise > 0:
        tail = f"within {terms.reward_within_hours} h — speed reward paid"
    elif outcome == "reward":           # W2: the rule promised nothing
        tail = f"within {terms.reward_within_hours} h — this rule pays no reward"
    elif outcome == "penalty" and terms.penalty_paise == 0:
        # The RULE charged nothing — a different sentence from the cap's, and
        # the reader is entitled to know which one stopped the money.
        tail = f"over {terms.penalty_after_hours} h — this rule charges no penalty"
    elif paid == 0:                     # the CAP refused the whole charge
        tail = (
            f"over {terms.penalty_after_hours} h — speed penalty not charged: "
            "monthly cap already reached"
        )
    elif paid < terms.penalty_paise:
        tail = (
            f"over {terms.penalty_after_hours} h — speed penalty partly "
            "charged: monthly cap"
        )
    elif outcome == "penalty":
        tail = f"over {terms.penalty_after_hours} h — speed penalty charged"
    else:
        tail = (
            f"between {terms.reward_within_hours} h and "
            f"{terms.penalty_after_hours} h — no speed reward or penalty"
        )

    note = f"{head} · {tail}"
    if clock_data.slot_start is not None:
        if clock_data.slot_start > clock_data.assigned_at:
            # R1's usual pool case — say WHERE the clock started, or a reader
            # seeing "finished in 3 h" for a job held four days will read it
            # as a bug rather than as the ruling it is.
            note = f"{note} · counted from the slot start, {_clock_label(clock_data.slot_start)}"
        elif clock_data.assigned_at >= clock_data.slot_start:
            note = f"{note} · counted from the accept"
    return note


def _clock_label(at: datetime.datetime) -> str:
    """`Thu 10:00 AM` in IST — the day the slot starts and the instant it
    starts at, the same two halves `when_label` renders. A slot is quoted by
    its day because a clock that starts days after the accept is the case the
    ruling exists to name, and the day is the difference a reader needs."""
    hm, ap = clock(at)
    return f"{at.astimezone(IST).strftime('%a')} {hm} {ap}"