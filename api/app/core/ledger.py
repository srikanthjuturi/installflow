"""Writing to the penalty pool, and the two questions anybody asks it.

`models/ledger.py` says what an entry IS. This says how one comes to exist and
what the rows add up to, and it lives in `core/` because three slices need it
and slices never import each other (hard rule 4):

  * **jobs** charges a penalty when a technician gives up a job;
  * **tickets** pays a bonus when somebody picks an escalated one up;
  * **the ledger read** shows the balance the first two move.

## The cap is a calendar month in IST

`cancel_penalty_cap_paise` bounds what one technician can be charged in a
month, and "month" was settled where the rule is defined rather than left to
whoever wrote this: a rolling 30 days would cap on one clock and pay on
another, letting a single settlement carry more than the cap — which is the one
thing the cap is for. IST because that is how this codebase already reckons a
day.

**A cap of 0 means NO cap**, not "charge nothing". A technician who should
never be charged is one whose bands are zero.
"""

import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES
from app.models.ledger import LedgerEntry

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


async def charged_this_month(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    now: datetime.datetime | None = None,
) -> int:
    """Penalties already charged to this technician in the current IST month."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    total = await db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount_paise), 0)).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id == technician_id,
            LedgerEntry.kind == "penalty",
            LedgerEntry.created_at >= month_start(now),
        )
    )
    return int(total or 0)


def cap_remaining(*, cap_paise: int, already_charged: int) -> int | None:
    """What is left of this technician's monthly cap. `None` means uncapped."""
    if cap_paise == 0:
        return None
    return max(0, cap_paise - already_charged)


def entry(
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    ticket_id: uuid.UUID,
    kind: str,
    amount_paise: int,
    reason: str,
    by_user: uuid.UUID | None = None,
) -> LedgerEntry:
    """Build the row for money that just moved. The caller adds and commits it.

    Returned rather than added, exactly as `tickets.service.record_event` is
    and for the same reason: money must commit with the thing it is about,
    never separately. A penalty that survived a rolled-back cancellation would
    charge somebody for a job they still hold.
    """
    return LedgerEntry(
        company_id=company_id,
        technician_id=technician_id,
        ticket_id=ticket_id,
        kind=kind,
        amount_paise=amount_paise,
        reason=reason,
        created_by=by_user,
    )


async def pool(db: AsyncSession, *, company_id: uuid.UUID) -> dict[str, int]:
    """The pool, as the arithmetic rather than as three unrelated tiles.

    §7 makes penalties and bonuses one fact — money in equals money out — so
    this is one grouped query and `balance` is derived from the two sums rather
    than stored. A stored balance is a number that can disagree with the rows
    it claims to summarise, and it eventually does.

    `cancellations` and `pickups` are counts of the entries, not of tickets: a
    ticket cancelled twice is two penalties, which is exactly what the pool
    collected.
    """
    rows = await db.execute(
        select(
            LedgerEntry.kind,
            func.coalesce(func.sum(LedgerEntry.amount_paise), 0),
            func.count(),
        )
        .where(LedgerEntry.company_id == company_id)
        .group_by(LedgerEntry.kind)
    )
    totals = {kind: (int(amount), int(count)) for kind, amount, count in rows}
    penalties, cancellations = totals.get("penalty", (0, 0))
    bonuses, pickups = totals.get("bonus", (0, 0))
    return {
        "balancePaise": penalties - bonuses,
        "penaltiesCollectedPaise": penalties,
        "cancellations": cancellations,
        "bonusesPaidPaise": bonuses,
        "pickups": pickups,
    }
