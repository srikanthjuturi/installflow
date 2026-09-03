"""A technician's own earnings, over a day, a week or a month.

Read-only and scoped to ONE technician — the profile resolved from the bearer
token, never an id in the request. There is no path here to another person's
money, which is why these routes need no territory rule: the narrowest possible
scope is applied before any of them run.

## Why it is its own slice rather than part of `ledger`

`features/ledger` answers the company's question — what has the pool collected
and paid, by whom — and is gated on `earnings.view`, which is admin and
national head. This answers the technician's: what did I make this week. Same
table, opposite ends, and the audiences must never be able to reach each
other's endpoint. Two slices with two guards is what makes that structural
rather than a filter somebody could forget.
"""

import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ledger import window_dates
from app.core.rules import CANCEL_PENALTY_BANDS
from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES
from app.features.earnings.schemas import EarningsSummaryOut, TransactionOut
from app.models.ledger import LedgerEntry
from app.models.ticket import Ticket

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))

#: The half-open UTC range to read over, already resolved.
#:
#: A resolved range rather than the period's NAME, because there are now two
#: ways to say what to read — a named period or a range off the calendar — and
#: the router settles which before either of these runs. That is what keeps the
#: hero figures and the list under them describing the same span: one decision,
#: made once, passed to both.
Window = tuple[datetime.datetime, datetime.datetime]


async def summary(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    window: Window,
) -> EarningsSummaryOut:
    """The four hero figures. Two of them are null — see the schema on why.

    One grouped query rather than two counts: bonuses and penalties are the
    same table filtered two ways, and asking twice would let a row written
    between the two reads land in neither total.
    """
    start, end = window
    rows = await db.execute(
        select(
            LedgerEntry.kind,
            func.coalesce(func.sum(LedgerEntry.amount_paise), 0),
        )
        .where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.technician_id == technician_id,
            LedgerEntry.created_at >= start,
            LedgerEntry.created_at < end,
        )
        .group_by(LedgerEntry.kind)
    )
    totals = {kind: int(amount) for kind, amount in rows}
    covered_from, covered_to = window_dates(window)
    earned = totals.get("payout", 0)
    bonuses = totals.get("bonus", 0)
    penalties = totals.get("penalty", 0)
    return EarningsSummaryOut(
        # The whole arithmetic of the screen, in one line and in one place.
        # Bonuses add, penalties subtract — `penalties` is a magnitude, because
        # `kind` carries the direction (see `models/ledger.py`).
        #
        # It can go negative, in a week with heavy cancellations and little
        # work. That is a true statement about a bad week and the phone renders
        # the minus; the monthly cap is what stops it running away. This used to
        # return None for both this and `earned`, when nothing priced an install.
        netPaise=earned + bonuses - penalties,
        earnedPaise=earned,
        bonusesPaise=bonuses,
        penaltiesPaise=penalties,
        # Derived from the SAME window the sums were taken over, one line below
        # them, so the label and the figures cannot come apart.
        dateFrom=covered_from,
        dateTo=covered_to,
    )


#: What each row is called on the phone.
#:
#: Resolved here because it depends on WHICH band the row came from, and the
#: band is a server fact. The two cancellation titles are the approved
#: prototype's own words; the no-show one is new (see AGENTS.md rule 6).
def _title(kind: str, reason: str) -> str:
    # A payout's title was decided when it was paid and stored in `reason` —
    # "Install · Reliance GreenTech 55\" QLED". It has to be, because it names
    # the MODEL, which is not on the ledger row; and because a model renamed
    # next year must not retitle money already paid. See `ledger.payout_reason`.
    if kind == "payout":
        return reason
    if kind == "bonus":
        return "Reassignment bonus"
    # `record_no_show` writes the band label verbatim as its reason, while a
    # cancellation writes "Cancel <band>". Matching on that is a coupling worth
    # naming: if either writer changes its wording, change this with it.
    if reason == CANCEL_PENALTY_BANDS[-1]:
        return "No-show penalty"
    return "Late cancellation penalty"


def _when(at: datetime.datetime, now: datetime.datetime) -> str:
    """`Today`, `Yesterday`, or `5 Aug` — in the technician's own day.

    IST rather than the device's locale, and deliberately: the row belongs to
    the shift they worked, and a technician near midnight should see the same
    day the daily cap and the penalty month counted it in.
    """
    local = at.astimezone(IST).date()
    today = now.astimezone(IST).date()
    if local == today:
        return "Today"
    if (today - local).days == 1:
        return "Yesterday"
    return f"{local.day} {local:%b}"


async def transactions(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    window: Window,
) -> list[TransactionOut]:
    """This technician's own ledger for the window, newest first.

    Not paginated, and `MAX_RANGE_DAYS` is what keeps that honest: a bounded
    span of one person's work is a handful of rows even for somebody having a
    bad year — and the screen scrolls rather than pages.

    Ordered by `created_at` then `id`, because two entries written in one
    transaction share a timestamp and an unstable sort would reorder them
    between reads of the same list.
    """
    start, end = window
    rows = list(
        await db.scalars(
            select(LedgerEntry)
            .where(
                LedgerEntry.company_id == company_id,
                LedgerEntry.technician_id == technician_id,
                LedgerEntry.created_at >= start,
                LedgerEntry.created_at < end,
            )
            .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
        )
    )
    if not rows:
        return []

    # `company_id` as well as the ids, and not because the ids could belong to
    # anyone else — they came off rows already scoped to this company. Hard rule
    # 0 is that every query on a tenant table carries the filter, so that no
    # future edit to where `rows` comes from can quietly turn this into the leak
    # it is one line away from being.
    codes = {
        r[0]: r[1]
        for r in await db.execute(
            select(Ticket.id, Ticket.code).where(
                Ticket.company_id == company_id,
                Ticket.id.in_({e.ticket_id for e in rows}),
            )
        )
    }
    now = datetime.datetime.now(datetime.timezone.utc)
    return [
        TransactionOut(
            id=e.id,
            at=e.created_at,
            kind=e.kind,
            amountPaise=e.amount_paise,
            title=_title(e.kind, e.reason),
            subtitle=f"{_when(e.created_at, now)} · {codes.get(e.ticket_id, '—')}",
            ticketCode=codes.get(e.ticket_id) or "—",
        )
        for e in rows
    ]
