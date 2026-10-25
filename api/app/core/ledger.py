"""Writing to the penalty pool, and the two questions anybody asks it.

`models/ledger.py` says what an entry IS. This says how one comes to exist and
what the rows add up to, and it lives in `core/` because three slices need it
and slices never import each other (hard rule 4):

  * **jobs** charges a penalty when a technician gives up a job;
  * **tickets** pays a bonus when somebody picks an escalated one up;
  * **the ledger read** shows the balance the first two move;
  * **redemptions** and **technicians** both ask the redeemable balance
    (`credited` / `reserved` / `redeemable_balance` below — Task 05's type
    switch refuses to send a freelancer's unredeemed stream into salary).

## The cap is a calendar month in IST

`cancel_penalty_cap_paise` bounds what one technician can be charged in a
month, and "month" was settled where the rule is defined rather than left to
whoever wrote this: a rolling 30 days would cap on one clock and pay on
another, letting a single settlement carry more than the cap — which is the one
thing the cap is for. IST because that is how this codebase already reckons a
day.

**A cap of 0 means NO cap**, not "charge nothing". A technician who should
never be charged is one whose bands are zero.

## A reversed penalty was never charged, for every sum here

A manager can give a penalty back, which writes a `reversal` row naming it
(`models/ledger.py`). Each reader decides what that means for its own question,
out loud, the way each already applies its own sign:

  * **the cap** skips a reversed penalty, keyed on the PENALTY's month — an
    October reversal of a September charge frees September, not October;
  * **the pool** treats a reversal as money out, like a bonus;
  * **the technician's earnings** leave out both rows, so their screen reads
    as if the charge never happened (`earnings.service`).

`not_reversed()` is the one predicate all of them use.
"""

import datetime
import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES
from app.models.ledger import CAPPED_KINDS, POOL_KINDS, LedgerEntry
from app.models.redemption import Redemption
from app.models.technician import (
    TYPE_FREELANCER,
    TechnicianProfile,
)

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))


def month_start(when: datetime.datetime) -> datetime.datetime:
    """Midnight on the 1st of `when`'s IST month, as a UTC instant.

    A half-open lower bound, so the comparison stays on `created_at` and can
    use `ix_ledger_entries_company_technician` — the same reason
    `coverage.ist_day_bounds` exists rather than a `::date` cast.
    """
    local = when.astimezone(IST)
    first = local.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    return first.astimezone(datetime.timezone.utc)


#: The named spans a technician may look at their own earnings over.
#:
#: Three, and no "all time": the screen leads with a single big figure, and a
#: lifetime total answers a question nobody standing in a stairwell is asking.
#: Anything else they want is a `range_bounds` range they pick on the calendar.
EARNINGS_PERIODS = ("day", "week", "month")

#: The longest span the earnings reads will answer for, in days.
#:
#: `earnings.transactions` is unpaginated, and what made that safe was that a
#: period was a day, a week or a month. A range somebody picks removes that
#: guarantee, so the bound moves here rather than quietly disappearing. A year
#: of one technician's own bonuses and penalties is still a short list.
MAX_RANGE_DAYS = 366


def period_bounds(
    period: str, now: datetime.datetime | None = None
) -> tuple[datetime.datetime, datetime.datetime]:
    """The half-open UTC range covering an IST day, week or month.

    IST throughout, because that is how this product already reckons a day —
    the daily job cap counts by SLOT date in IST and the monthly penalty cap by
    IST calendar month. A technician's Monday has to be the same Monday in all
    three places or two screens will disagree about the same shift.

    **The week runs Monday to Sunday**, which is the approved screen's own
    subtitle rather than a choice made here.

    **The month is the calendar month**, deliberately matching
    `cancel_penalty_cap_paise` — a technician who has hit their monthly cap and
    switches this screen to "month" should see the period the cap was counted
    over, not a different thirty days.

    Half-open (`start <= t < end`) and returned as UTC instants, so every
    comparison stays on an indexed column rather than wrapping it in a
    timezone function — the same reason `coverage.ist_day_bounds` exists.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    local = now.astimezone(IST)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "day":
        start = midnight
        end = start + datetime.timedelta(days=1)
    elif period == "month":
        start = midnight.replace(day=1)
        # Adding a month means landing on the 1st of the next one, and there is
        # no `timedelta(months=1)`. Stepping past the longest month and
        # truncating is exact for every month including February.
        end = (start + datetime.timedelta(days=32)).replace(day=1)
    else:  # "week", and the default for anything unrecognised
        # `weekday()` is 0 for Monday, which is what the approved subtitle says.
        start = midnight - datetime.timedelta(days=local.weekday())
        end = start + datetime.timedelta(days=7)

    return (
        start.astimezone(datetime.timezone.utc),
        end.astimezone(datetime.timezone.utc),
    )


def _ist_midnight(day: datetime.date) -> datetime.datetime:
    """Midnight at the start of an IST calendar day, as a UTC instant."""
    return datetime.datetime.combine(
        day, datetime.time(0), tzinfo=IST
    ).astimezone(datetime.timezone.utc)


def range_bounds(
    start: datetime.date, end: datetime.date
) -> tuple[datetime.datetime, datetime.datetime]:
    """Two IST calendar dates as a half-open UTC range, inclusive at both ends.

    The sibling of `period_bounds` for a span somebody picked rather than named,
    and it reckons identically: IST days, because a technician's Monday has to
    be the same Monday everywhere this product counts one; half-open at the top,
    so an entry written at 11:59 PM on the last day is inside the range; UTC
    instants, so the comparison stays on the indexed `created_at` rather than
    wrapping it in a timezone function Postgres cannot use an index through.

    **Reversed dates are swapped rather than refused.** Two taps on a calendar
    arrive in whichever order the thumb landed, and "2 Sep to 12 Aug" has one
    obvious meaning. Erroring would be pedantry on the screen about their money.
    """
    if end < start:
        start, end = end, start
    return _ist_midnight(start), _ist_midnight(end) + datetime.timedelta(days=1)


def range_days(start: datetime.date, end: datetime.date) -> int:
    """How many calendar days a range covers, counting both ends."""
    return abs((end - start).days) + 1


def window_dates(
    window: tuple[datetime.datetime, datetime.datetime],
) -> tuple[datetime.date, datetime.date]:
    """The IST calendar days a resolved window covers, inclusive at both ends.

    The inverse of `range_bounds`, and it exists so a response can SAY what it
    answered over. Without that the phone can only caption what it asked for —
    and a client talking to a server that has not learned `dateFrom` yet would
    label this week's money with the range somebody picked, silently. A figure
    whose label came from a different question is the one failure this screen
    must not have.

    The upper bound is exclusive, so the last day is the midnight before it.
    """
    start, end = window
    last = end - datetime.timedelta(days=1)
    return start.astimezone(IST).date(), last.astimezone(IST).date()


def not_reversed():
    """WHERE-clause: this `LedgerEntry` row has not been given back.

    Correlated to the outer `LedgerEntry`, and answered by
    `uq_ledger_entries_reverses` — the partial unique on `(company_id,
    reverses_id)` — so it is an index probe per row, not a scan. Only a penalty
    can ever be reversed, so on any other kind this is simply always true.
    """
    reversal = aliased(LedgerEntry)
    return ~exists().where(
        reversal.company_id == LedgerEntry.company_id,
        reversal.reverses_id == LedgerEntry.id,
    )


def shown_to_technician():
    """What a technician's own money includes: everything but a given-back penalty.

    The `reversal` row and the penalty it names both drop out, so their screen
    reads as if the charge never happened. Lives here rather than in
    `earnings.service` because two readers now need the SAME answer: the
    Earnings screen's figures and the balance a redemption is cut from. If they
    ever filtered differently, a technician could be offered a sum their own
    screen does not add up to.

    A function, not a module constant, because `not_reversed()` builds a fresh
    correlated alias each time and a shared one would be reused across unrelated
    statements.
    """
    return (LedgerEntry.kind != "reversal", not_reversed())


async def credited(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> int:
    """What this technician has ever been owed in the FREELANCER stream:
    payouts + travel + bonuses − penalties.

    All time, and on purpose — this is the other half of a balance, not a
    screen's period figure. The kinds are read by name, so a kind added later
    moves nothing here until somebody decides which way it points. Task 10
    folds `travel` in beside `payout` (§4.4); the redemption balance reads
    this, so a travel credit is redeemable the same way a payout is. Task 11
    folds speed in the same way; the statement's `KIND_LINES` is the other
    reader.

    `technician_type == TYPE_FREELANCER` is Task 06 (T4): the redeemable
    balance is the freelancer stream ONLY. Salary money (the employee stream)
    is paid by payroll through the statement and is never redeemable — a
    technician who switched to an employee cannot take their salary out by
    UPI, and the type is stamped on the row at write time precisely so this
    filter can read the type the money moved under, not the type they are now.

    May be negative: a technician with heavy cancellations and little work owes
    the difference, and it carries forward against the next payout.
    """
    rows = await db.execute(
        select(
            LedgerEntry.kind,
            func.coalesce(func.sum(LedgerEntry.amount_paise), 0),
        )
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id == technician_id,
            LedgerEntry.technician_type == TYPE_FREELANCER,
            *shown_to_technician(),
        )
        .group_by(LedgerEntry.kind)
    )
    totals = {kind: int(amount) for kind, amount in rows}
    return (
        totals.get("payout", 0)
        + totals.get("travel", 0)                  # Task 10: travel is earned
        + totals.get("bonus", 0)
        + totals.get("speed_reward", 0)            # Task 11: a fast finish is owed
        - totals.get("penalty", 0)
        - totals.get("speed_penalty", 0)           # Task 11: a slow finish is a debit
    )


async def reserved(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> int:
    """Every redemption not declined — paid, being paid, or waiting to be.

    An open one counts from the moment it is asked for, not from when it is
    confirmed: the money is spoken for, and counting it only once settled would
    let a technician ask for the same balance twice while the first request sat
    in somebody's queue.
    """
    total = await db.scalar(
        select(func.coalesce(func.sum(Redemption.amount_paise), 0)).where(
            Redemption.company_id == company_id,
            Redemption.technician_id == technician_id,
            Redemption.declined_at.is_(None),
        )
    )
    return int(total or 0)


async def redeemable_balance(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> int:
    """What this technician is owed and has not yet asked for. May be negative.

    The freelancer stream (`credited` above) minus every redemption not
    declined. Lives beside `credited` rather than in `features.redemptions`
    because two slices ask it — the redemption request and Task 05's
    type-change guard (`R5`: refuse freelancing money into an employee).
    Slices never import each other (hard rule 4).
    """
    owed = await credited(db, company_id=company_id, technician_id=technician_id)
    return owed - await reserved(
        db, company_id=company_id, technician_id=technician_id
    )


async def open_redemption_exists(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> bool:
    """Is there a redemption neither confirmed nor declined?

    Exactly the `uq_redemptions_one_open` predicate, so it can be true for at
    most one row. Lives beside `redeemable_balance` for the same reason: two
    slices ask (the redemption request, and Task 17's technician transfer, which
    refuses to move somebody whose payment is still being settled — it is owed
    by the OLD franchisee's payer, who could no longer see it after the move).
    Slices never import each other (hard rule 4).
    """
    return (
        await db.scalar(
            select(Redemption.id)
            .where(
                Redemption.company_id == company_id,
                Redemption.technician_id == technician_id,
                Redemption.confirmed_at.is_(None),
                Redemption.declined_at.is_(None),
            )
            .limit(1)
        )
    ) is not None


async def open_redemption_code(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> str | None:
    """The code of that open redemption (`RGT-RDM-0007`), or None. The transfer's
    refusal names it so the person knows which payment to settle."""
    return await db.scalar(
        select(Redemption.code)
        .where(
            Redemption.company_id == company_id,
            Redemption.technician_id == technician_id,
            Redemption.confirmed_at.is_(None),
            Redemption.declined_at.is_(None),
        )
        .limit(1)
    )


async def charged_this_month(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    now: datetime.datetime | None = None,
) -> int:
    """Penalties of either kind charged to this technician in the current IST
    month and not given back.

    Both capped kinds (S6, Task 11): a cancellation and a slow job draw down
    the SAME `cancel_penalty_cap_paise`, so each preview and each charge has to
    see the other. A reversed penalty frees its room under the cap. Keyed on
    when the PENALTY was written, not the reversal: giving back a September
    charge in October must make September right again, not hand October extra
    headroom.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    total = await db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount_paise), 0)).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id == technician_id,
            LedgerEntry.kind.in_(CAPPED_KINDS),
            LedgerEntry.created_at >= month_start(now),
            not_reversed(),
        )
    )
    return int(total or 0)


def cap_remaining(*, cap_paise: int, already_charged: int) -> int | None:
    """What is left of this technician's monthly cap. `None` means uncapped."""
    if cap_paise == 0:
        return None
    return max(0, cap_paise - already_charged)


def capped_charge(amount_paise: int, remaining: int | None) -> int:
    """What is actually charged: all of it when uncapped (`None`), else the
    SMALLER of the band and what remains of the month's cap — 0 when nothing
    remains, which the caller spells "write no row" (W8).

    Pure, beside `cap_remaining`, and it exists because the same min() stood
    inline in three places — `jobs.service._band_for`'s cancellation preview
    and charge, `tickets.service.record_no_show`, and Task 11's speed
    penalty — and three copies of one arithmetic is the copy that drifts when
    the cap's meaning next changes.
    """
    return amount_paise if remaining is None else min(amount_paise, remaining)


#: The one service type whose display name is not its stored name.
#:
#: The approved prototype's earnings row reads `Install · Reliance GreenTech 55"
#: QLED`, and "Install" is what `Installation + Demo` is called there — the
#: prototype was drawn when installation was the only job this product did.
#: `Tech Visit` and `Service` are already short enough to print as stored.
_PAYOUT_LABELS = {"Installation + Demo": "Install"}


def payout_reason(*, service_type: str, model_name: str) -> str:
    """What a payout row is called on the technician's Earnings screen.

    Written into `reason` at closure rather than derived at read time, for the
    reason that column exists: a model can be renamed and a service type
    re-worded, and a record of money says what was true when it was paid.

    The slice is a guard, not an expectation — a 120-character model name plus
    the longest label is 141, comfortably inside the column's 160.
    """
    label = _PAYOUT_LABELS.get(service_type, service_type)
    return f"{label} · {model_name}"[:160]


def travel_reason(*, km: float | None, force_closed: bool = False) -> str:
    """What a travel row says, decided when it was paid (the `payout_reason` rule).

    A force-closure's reason does NOT quote km (Task 10): the amount is the
    manager's, so a km figure beside it would imply an arithmetic that did not
    happen. The frozen km is still on the ticket's `accept_snapshot`, where the
    estimate it froze can be checked against the payment actually made.
    """
    if force_closed:
        return "Travel allowance · set at force-closure"
    return f"Travel allowance · {km:.1f} km"[:160]


def entry(
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    ticket_id: uuid.UUID,
    kind: str,
    amount_paise: int,
    reason: str,
    by_user: uuid.UUID | None = None,
    reverses_id: uuid.UUID | None = None,
    franchisee_id: uuid.UUID | None = None,
    technician_type: str | None = None,
) -> LedgerEntry:
    """Build the row for money that just moved. The caller adds and commits it.

    Returned rather than added, exactly as `tickets.service.record_event` is
    and for the same reason: money must commit with the thing it is about,
    never separately. A penalty that survived a rolled-back cancellation would
    charge somebody for a job they still hold.

    `reverses_id` is for a `reversal` and nothing else — the CHECK
    `reversal_points_back` holds the two together.

    `franchisee_id` defaults to the technician's franchisee AT WRITE TIME, read
    inside the INSERT itself (an embedded scalar subquery), so it cannot drift
    from the row it describes and no caller has to load the profile first. Pass
    it only to override — a reversal does, so money goes back out of the pool
    that collected the penalty even if the technician has since moved franchisee
    (00-index.md §3.2, §4.6).

    `technician_type` defaults the same way to the technician's type at write
    time (Task 05 §3.3) — the stream Task 06 sorts redemption-eligible from
    salary money with. Pass it only to override: the reversal passes
    `penalty.technician_type`, because it undoes that row in that pool and in
    that stream.

    ⚠ After a flush BOTH stamped attributes are EXPIRED when a default
    subquery is used. Reading `row.franchisee_id` / `row.technician_type` in
    async code without
    `await db.refresh(row, ["franchisee_id", "technician_type"])` raises
    `MissingGreenlet`. Penalties/bonuses/payouts have no current caller reading
    them back; the reversal's reads land in `core.penalty_reversal`, which
    refreshes.
    """
    return LedgerEntry(
        company_id=company_id,
        technician_id=technician_id,
        ticket_id=ticket_id,
        kind=kind,
        amount_paise=amount_paise,
        reason=reason,
        created_by=by_user,
        reverses_id=reverses_id,
        franchisee_id=(
            franchisee_id
            if franchisee_id is not None
            else select(TechnicianProfile.franchisee_id)
            .where(
                TechnicianProfile.company_id == company_id,
                TechnicianProfile.id == technician_id,
            )
            .scalar_subquery()
        ),
        technician_type=(
            technician_type
            if technician_type is not None
            else select(TechnicianProfile.technician_type)
            .where(
                TechnicianProfile.company_id == company_id,
                TechnicianProfile.id == technician_id,
            )
            .scalar_subquery()
        ),
    )


def pool_arithmetic(totals: dict) -> dict[str, int]:
    """PURE. The pool from grouped `{(kind, target kind): (amount_paise, count)}`
    totals.

    §7 makes penalties and bonuses one fact — money in equals money out — so
    the balance is derived from the sums rather than stored. A stored balance
    is a number that can disagree with the rows it claims to summarise, and it
    eventually does.

    The key is a PAIR since Task 11: a `reversal` row is pool-money OUT, but
    it undoes one specific kind of charge, and the two nets are reported
    separately (§4.7) — a speed penalty given back must net out of the
    `speedPenalty*` breakdown and NOT out of `cancellations`. Everything that
    is not a reversal carries `None` as its target kind. The tests from Task
    05 (§6 cases 17–20) still pass a BARE string key, so a bare key is read as
    `(kind, None)` — and a bare `reversal` as a reversal OF `penalty`, which
    was the only kind that could be reversed before Task 11 and is what those
    cases assume. `pool()` always passes pairs.

    `cancellations` and `pickups` are counts of the entries, not of tickets: a
    ticket cancelled twice is two penalties, which is exactly what the pool
    collected. Kinds outside POOL_KINDS (a `payout`, `travel`) are ignored —
    the pool is the money-in/money-out circuit, and Task 11 folded the two
    speed kinds INTO it (S6) rather than beside it.
    """
    paired = {
        (key, "penalty")
        if key == "reversal"
        else (key if isinstance(key, tuple) else (key, None)): value
        for key, value in totals.items()
    }
    penalties, charged = paired.get(("penalty", None), (0, 0))
    speed_penalties, speed_charged = paired.get(("speed_penalty", None), (0, 0))
    restored, cancelled_back = paired.get(("reversal", "penalty"), (0, 0))
    speed_restored, speed_backed = paired.get(("reversal", "speed_penalty"), (0, 0))
    bonuses, pickups = paired.get(("bonus", None), (0, 0))
    speed_rewards, speed_paid = paired.get(("speed_reward", None), (0, 0))
    # A reversal is money back OUT of the pool, and it is netted into what was
    # "collected" rather than shown as a third figure: a charge given back was
    # never really collected, and the console prints `collected − bonuses =
    # balance` only while that arithmetic holds. The nets are split by the
    # TARGET kind so `cancellations` keeps counting cancellation/no-show
    # penalties alone (W11) while the speed figures stand beside them.
    cancel_net = penalties - restored
    speed_net = speed_penalties - speed_restored
    collected = cancel_net + speed_net
    paid = bonuses + speed_rewards
    return {
        "balancePaise": collected - paid,
        "penaltiesCollectedPaise": collected,
        "cancellations": charged - cancelled_back,
        "bonusesPaidPaise": paid,
        "pickups": pickups,
        # Task 11's breakdown fields: the parts the two folded tiles above
        # already include, so Task 13's pool card can show the split without
        # anybody's arithmetic breaking in between.
        "speedPenaltyPaise": speed_net,
        "speedPenalties": speed_charged - speed_backed,
        "speedRewardPaise": speed_rewards,
        "speedRewards": speed_paid,
    }


async def pool(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
) -> dict[str, int]:
    """One franchisee's pool, as the arithmetic rather than as three unrelated
    tiles (F12 — one pool per franchisee, Task 05 §4.12).

    §7 makes penalties and bonuses one fact — money in equals money out — so
    this is one grouped query and `balance` is derived from the sums rather
    than stored. `franchisee_id` is REQUIRED, not defaulted to a home lookup at
    this layer: which pool a read is about is decided by the caller
    (`core.franchise_money.pool_franchisee`), where the principal is in reach.

    There is deliberately no "all franchisees" total — every pool read names
    its franchisee, the way every money read always will (out of scope, §8).
    """
    # Scoped to POOL_KINDS explicitly: a new kind is unread until this line is
    # told about it, which is the loud failure, not the silent one.
    #
    # A reversal is grouped by the KIND IT UNDID (§4.7): a LEFT JOIN an alias
    # on `reverses_id`, and the alias's own `kind` rides in the group key. A
    # speed penalty given back nets out of the speed column; a cancellation
    # given back out of `cancellations`; neither touches the other (W11). The
    # reversal row's `franchisee_id` is the PENALTY's (`core.ledger.entry`),
    # so the pair still lands in exactly one pool — this one.
    target = aliased(LedgerEntry)
    rows = await db.execute(
        select(
            LedgerEntry.kind,
            target.kind,
            func.coalesce(func.sum(LedgerEntry.amount_paise), 0),
            func.count(),
        )
        .outerjoin(target, target.id == LedgerEntry.reverses_id)
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.franchisee_id == franchisee_id,
            LedgerEntry.kind.in_(POOL_KINDS),
        )
        .group_by(LedgerEntry.kind, target.kind)
    )
    totals = {
        (kind, target_kind): (int(amount), int(count))
        for kind, target_kind, amount, count in rows
    }
    return pool_arithmetic(totals)
