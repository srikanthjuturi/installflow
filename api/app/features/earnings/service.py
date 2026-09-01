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

from app.core.ledger import period_bounds
from app.core.rules import CANCEL_PENALTY_BANDS
from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES
from app.features.earnings.schemas import EarningsSummaryOut, TransactionOut
from app.models.ledger import LedgerEntry
from app.models.ticket import Ticket

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))


async def summary(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    period: str,
) -> EarningsSummaryOut:
    """The four hero figures. Two of them are null — see the schema on why.

    One grouped query rather than two counts: bonuses and penalties are the
    same table filtered two ways, and asking twice would let a row written
    between the two reads land in neither total.
    """
    start, end = period_bounds(period)
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
    return EarningsSummaryOut(
        # Not `bonuses - penalties`. See the schema: that figure would be a
        # different lie, not a smaller one.
        netPaise=None,
        earnedPaise=None,
        bonusesPaise=totals.get("bonus", 0),
        penaltiesPaise=totals.get("penalty", 0),
    )


#: What each row is called on the phone.
#:
#: Resolved here because it depends on WHICH band the row came from, and the
#: band is a server fact. The two cancellation titles are the approved
#: prototype's own words; the no-show one is new (see AGENTS.md rule 6).
def _title(kind: str, reason: str) -> str:
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
    period: str,
) -> list[TransactionOut]:
    """This technician's own ledger for the period, newest first.

    Not paginated. A period is a day, a week or a month of one person's work,
    which is a handful of rows even for somebody having a bad month — and the
    screen scrolls rather than pages.

    Ordered by `created_at` then `id`, because two entries written in one
    transaction share a timestamp and an unstable sort would reorder them
    between reads of the same list.
    """
    start, end = period_bounds(period)
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

    codes = {
        r[0]: r[1]
        for r in await db.execute(
            select(Ticket.id, Ticket.code).where(
                Ticket.id.in_({e.ticket_id for e in rows})
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
