"""Which two-hour windows a visit can still be booked into.

Two slices need this and hard rule 4 says they may not reach into each other:
`tickets` renders the customer's choices and validates what they pick, and
`jobs` has to ask the same question before letting a technician take a job that
has no time yet.

Its own module rather than a home in `core.tickets`, which holds the vocabulary
these are built from (`SLOT_WINDOWS`, `SLOT_LEAD_MINUTES`). `bookable_slots`
needs `core.coverage` for the cap statuses, and `core.coverage` already imports
`core.tickets` — putting this there would close the loop. Here the dependencies
run one way: slots → coverage → tickets.
"""

import datetime
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.coverage import CAP_EXEMPT_STATUSES
from app.core.tickets import (
    SLOT_LEAD_MINUTES,
    SLOT_TIMEZONE_OFFSET_MINUTES,
    SLOT_WINDOWS,
)
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def offered_slots(
    row: Ticket, *, now: datetime.datetime | None = None
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """Every window this ticket could still be served in, soonest first.

    Bounded at both ends, and both bounds matter:

      * not sooner than SLOT_LEAD_MINUTES from now — nobody can be dispatched to
        an address in ten minutes;
      * not later than `sla_due_at` — the service level says the slot must START
        within N hours of the ticket being raised, so a window past that is one
        the company has already promised not to offer.

    Because the list is generated from the window rather than filtered
    afterwards, a customer CANNOT pick a slot that breaches. That is the point:
    the constraint lives where the choice is made, not in a validator that has
    to say no to something already chosen.

    Empty is a real answer — a 12-hour ticket raised at 22:00 has nothing left
    to offer, and the page says so rather than showing an empty list.

    Pure and synchronous on purpose: `check_slot_bookable` runs it inside ticket
    creation, where there is no technician to consider and a database round trip
    would be one nobody needs. What a technician can actually serve is
    `bookable_slots` below.
    """
    now = now or _now()
    earliest = now + datetime.timedelta(minutes=SLOT_LEAD_MINUTES)
    latest = row.sla_due_at

    out: list[tuple[datetime.datetime, datetime.datetime]] = []
    # Walk local days, because the windows are local working hours. Three is
    # enough for the longest service level (48h) plus the day it spills into.
    start_day = earliest.astimezone(IST).date()
    for offset in range(4):
        day = start_day + datetime.timedelta(days=offset)
        for from_hour, to_hour in SLOT_WINDOWS:
            begins = datetime.datetime.combine(
                day, datetime.time(from_hour, tzinfo=IST)
            )
            ends = datetime.datetime.combine(day, datetime.time(to_hour, tzinfo=IST))
            if begins < earliest or begins > latest:
                continue
            out.append((begins, ends))
    return out


#: Sentinel for "use the row's own technician", so that `None` can mean the
#: honest thing — nobody is assigned — rather than being indistinguishable from
#: the argument being absent.
_UNSET: uuid.UUID = uuid.UUID(int=0)


async def bookable_slots(
    db: AsyncSession,
    row: Ticket,
    *,
    now: datetime.datetime | None = None,
    technician_id: uuid.UUID | None = _UNSET,
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    """`offered_slots`, minus the ones the assigned technician cannot serve.

    A technician can now accept a job BEFORE a time exists, so by the moment the
    customer opens their link there may already be somebody committed to it. Ask
    that customer to pick from every window in the service level and they will
    cheerfully choose one their technician is already standing in somebody
    else's kitchen for.

    Two subtractions, and only when a technician is actually assigned:

      * **windows overlapping a job they already hold** — half-open, so a job
        ending at 14:00 does not block the window starting at 14:00;
      * **whole days their `daily_job_cap` is already spent on** — the same
        count `has_cap_room` uses, so a day the cap would refuse is never
        offered in the first place.

    Unassigned, this is exactly `offered_slots` and costs one branch. That is
    the common case, and the ordinary flow is untouched by any of it.

    `technician_id` overrides the one on the row, which is what `jobs.accept`
    needs: it asks the hypothetical — "if I took this, could I serve it?" —
    before any row has been written. A parameter beats assigning to `row` and
    putting it back, which would leave a dirty attribute on a tracked object for
    the next flush to find.

    ## Empty is a real answer, and now a worse one

    It already meant "the service level has run out". It can now also mean "the
    person who took this is full" — a dead end WE created and the customer
    cannot fix. The acceptance guard in `jobs.accept` makes it rare rather than
    impossible, because a technician can fill up after taking the job.
    """
    against = row.technician_id if technician_id is _UNSET else technician_id

    windows = offered_slots(row, now=now)
    if against is None or not windows:
        return windows

    held = (
        await db.execute(
            select(Ticket.slot_start, Ticket.slot_end).where(
                Ticket.company_id == row.company_id,
                Ticket.technician_id == against,
                # Not this ticket. Re-booking a visit must not be blocked by the
                # time it currently holds.
                Ticket.id != row.id,
                Ticket.deleted_at.is_(None),
                Ticket.status.not_in(CAP_EXEMPT_STATUSES),
                Ticket.slot_start.is_not(None),
            )
        )
    ).all()

    cap = await db.scalar(
        select(TechnicianProfile.daily_job_cap).where(
            TechnicianProfile.company_id == row.company_id,
            TechnicianProfile.id == against,
        )
    )

    spent: dict[datetime.date, int] = {}
    for start, _end in held:
        day = start.astimezone(IST).date()
        spent[day] = spent.get(day, 0) + 1

    def free(begins: datetime.datetime, ends: datetime.datetime) -> bool:
        if cap is not None and spent.get(begins.astimezone(IST).date(), 0) >= cap:
            return False
        return not any(begins < h_end and h_start < ends for h_start, h_end in held)

    return [w for w in windows if free(*w)]


# ── how a window is written down ─────────────────────────────────────────────
#
# Here rather than in the tickets slice because a job can now be accepted
# before a time exists, so `jobs` has to render one too — the acceptance
# notice names the slot, or says there is not one yet. Two slices formatting
# the same instant two ways is how a customer gets offered `14:00` and then
# told `2:00 PM`.


def clock(at: datetime.datetime) -> tuple[str, str]:
    """`('10:00', 'AM')` in IST — the two halves, so a range can share one.

    `.lstrip("0")` rather than `%-I`, which is a glibc extension and raises on
    Windows, where this very much does get run. `%I` never yields `"00"`, so
    stripping cannot empty the string.
    """
    local = at.astimezone(IST)
    return local.strftime("%I:%M").lstrip("0"), local.strftime("%p").upper()


def clock_range(start: datetime.datetime, end: datetime.datetime) -> str:
    """`10:00 AM–12:00 PM`, or `2:00–4:00 PM` when it stays inside one half.

    12-hour throughout, which is the house style taken from the approved
    prototypes — the technician app reads `4:00 PM` and its job data reads
    `2:00–4:00 PM`. A range that does not cross noon says the meridiem once.
    """
    start_hm, start_ap = clock(start)
    end_hm, end_ap = clock(end)
    if start_ap == end_ap:
        return f"{start_hm}–{end_hm} {end_ap}"
    return f"{start_hm} {start_ap}–{end_hm} {end_ap}"


def day_label(at: datetime.datetime) -> str:
    """`Thu 21 Aug` in IST — `when_label` without the clock.

    The day the WORK happens, in the day the technician experiences, which is
    the same reckoning the daily cap counts by. A UTC rendering would put a
    05:00 IST job on the previous evening and make the cap's arithmetic look
    wrong to whoever it refused.
    """
    return at.astimezone(IST).strftime("%a %d %b")


def when_label(start: datetime.datetime, end: datetime.datetime) -> str:
    """`Thu 21 Aug, 10:00 AM–12:00 PM`, in the customer's own timezone."""
    return f"{day_label(start)}, {clock_range(start, end)}"
