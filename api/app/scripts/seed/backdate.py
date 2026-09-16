"""Shift a finished ticket, and everything written about it, into the past.

Why this exists: there is no clock seam in the services. Every one of them
reads `datetime.now(timezone.utc)` directly, and a job cannot be accepted for a
slot that has already gone. So the lifecycle is driven forward at real time —
which is what keeps prices, penalties and payouts genuine — and the row is
moved backwards afterwards.

Three traps, all of them silent:

1. `updated_at` carries `onupdate=func.now()` (`app/db/mixins.py`), so ANY
   later ORM write stomps a shifted row back to the real present. Backdating
   must therefore be the last thing that happens to a ticket, and every
   statement here sets `updated_at` explicitly.
2. `ticket_events` are ordered by `seq`, an identity column, NOT by
   `created_at`. Shifting timestamps cannot reorder a timeline — which is
   fine, because the lifecycle was driven in order — but it does mean a
   timeline can disagree with its own clock if a shift is applied unevenly.
   So every row about one ticket moves by the SAME delta.
3. `ledger_entries.created_at` is what the monthly penalty cap counts
   (`core/ledger.py`) and what the Earnings screen sorts by. Moving a penalty
   across an IST month boundary changes what the cap says, which is exactly
   why the check step re-verifies the cap after the shift, not before.

⚠ Only SETTLED tickets are shifted. A ticket still in the pool must keep its
future slot, or `pool_query`'s "slot_start > now" predicate drops it and the
job pool that the load test is meant to read comes back empty.
"""

import datetime
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: table -> the timestamp columns on it that describe WHEN, keyed by the column
#: that ties the row to one ticket. Mapped from the live schema; a column added
#: later and not listed here simply does not move, which is why `verify.py`
#: re-reads the timeline rather than trusting this list.
_TICKET_CHILDREN: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("ticket_events", "ticket_id", ("created_at", "updated_at")),
    ("ticket_proofs", "ticket_id", ("created_at", "updated_at", "captured_at")),
    ("ticket_attachments", "ticket_id", ("created_at", "updated_at")),
    ("ledger_entries", "ticket_id", ("created_at", "updated_at")),
    ("notifications", "ticket_id", ("created_at", "updated_at")),
)

#: The ticket's own moments. `expected_date` is a DATE and is shifted by whole
#: days; the rest are timestamptz.
_TICKET_TIMESTAMPS: tuple[str, ...] = (
    "created_at",
    "updated_at",
    "sla_due_at",
    "slot_start",
    "slot_end",
    "slot_confirmed_at",
    "customer_confirmed_at",
)


async def shift_ticket(
    db: AsyncSession, ticket_id: uuid.UUID, *, delta: datetime.timedelta
) -> None:
    """Move one settled ticket and all its children back by `delta`.

    Core SQL rather than the ORM, deliberately: the ORM would re-stamp
    `updated_at` from the mixin's `onupdate`, which is the one thing this must
    not do.
    """
    if delta.total_seconds() <= 0:
        raise ValueError("delta must be positive — this moves rows into the past")

    sets = ", ".join(f"{c} = {c} - :delta" for c in _TICKET_TIMESTAMPS)
    await db.execute(
        text(
            f"UPDATE tickets SET {sets}, "
            f"expected_date = expected_date - make_interval(days => :days) "
            f"WHERE id = :id"
        ),
        {"delta": delta, "days": delta.days, "id": ticket_id},
    )

    for table, fk, columns in _TICKET_CHILDREN:
        sets = ", ".join(f"{c} = {c} - :delta" for c in columns)
        await db.execute(
            text(f"UPDATE {table} SET {sets} WHERE {fk} = :id"),
            {"delta": delta, "id": ticket_id},
        )
