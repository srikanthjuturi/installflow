"""Allocating the next human-facing code, safely and in blocks.

Lives in `core/` rather than either slice because tickets and technicians both
need it and hard rule 4 forbids one slice importing another.

The allocation is a single statement:

    INSERT … VALUES (start + n)
    ON CONFLICT (company_id, name)
    DO UPDATE SET next_value = company_sequences.next_value + n
    RETURNING next_value

`ON CONFLICT DO UPDATE` is what makes a company's first ticket and its
thousandth take the same path — there is no "create the counter if missing"
branch to race against. The row lock the UPDATE takes is what serialises
concurrent callers.

It returns the value AFTER the increment, so a block of `n` codes is
`[returned - n, returned)`.

Caller keeps its own transaction: this does not commit. A rolled-back ticket
gives its number back, which is the point of not using a Postgres SEQUENCE.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: (prefix, first number). The first numbers are the ones the approved prototype
#: and the mobile app already display — `INST-240912` and `TCH-4021` — so they
#: are not arbitrary and must not be "tidied" to 1.
SEQUENCES: dict[str, tuple[str, int]] = {
    "ticket": ("INST-", 240912),
    "technician": ("TCH-", 4021),
}

_ALLOCATE = text(
    """
    INSERT INTO company_sequences (id, company_id, name, next_value,
                                   created_at, updated_at)
    VALUES (gen_random_uuid(), :company_id, :name, :start + :count,
            now(), now())
    ON CONFLICT (company_id, name) DO UPDATE
        SET next_value = company_sequences.next_value + :count,
            updated_at = now()
    RETURNING next_value
    """
)


async def allocate(
    db: AsyncSession, company_id: uuid.UUID, name: str, count: int = 1
) -> list[str]:
    """Claim `count` codes for this company, in order.

    Returns formatted codes (`['INST-240912', 'INST-240913']`), because every
    caller wants the string and formatting it in one place is what stops the
    prefix drifting between the two slices that use it.
    """
    if count < 1:
        raise ValueError("count must be at least 1")
    prefix, start = SEQUENCES[name]

    after = await db.scalar(
        _ALLOCATE,
        {"company_id": company_id, "name": name, "start": start, "count": count},
    )
    first = int(after) - count
    return [f"{prefix}{first + i}" for i in range(count)]


async def next_code(db: AsyncSession, company_id: uuid.UUID, name: str) -> str:
    """One code. The common case, and a thin wrapper so callers do not index."""
    return (await allocate(db, company_id, name, 1))[0]
