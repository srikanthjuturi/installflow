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

#: The kind token that sits between the company and the number:
#: `RGT-INST-0001`. Adding a third series costs an entry here and nothing else.
#:
#: Every series starts at 1 and is padded to WIDTH. They used to start at
#: 240912 and 4021, lifted from the approved prototypes — and 240912 in
#: particular read as a date (24-09 = September 2024) that nothing in the code
#: ever set or advanced. A counter that looks like it encodes something it does
#: not is worse than an obviously opaque one, so both were reset.
KINDS: dict[str, str] = {
    "ticket": "INST",
    "technician": "TCH",
}

#: Zero-padding for the counter. A MINIMUM width, not a cap: the 10,000th
#: ticket is `RGT-INST-10000` and simply gets one digit longer, which is the
#: only behaviour that cannot silently collide.
WIDTH = 4
START = 1


def format_code(company_code: str, kind: str, number: int) -> str:
    """The one place a human-facing code is assembled. `RGT-INST-0001`."""
    return f"{company_code}-{KINDS[kind]}-{number:0{WIDTH}d}"

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

    Returns formatted codes (`['RGT-INST-0001', 'RGT-INST-0002']`), because
    every caller wants the string and formatting it in one place is what stops
    the shape drifting between the two slices that use it.

    The company's own code is read here rather than passed in: a caller that
    supplied it could supply the wrong one, and a ticket carrying another
    tenant's prefix is the kind of thing nobody notices until it is printed.
    """
    if count < 1:
        raise ValueError("count must be at least 1")
    if name not in KINDS:
        raise ValueError(f"unknown code series {name!r}")

    company_code = await db.scalar(
        text("SELECT code FROM companies WHERE id = :company_id"),
        {"company_id": company_id},
    )
    if not company_code:
        raise ValueError(f"company {company_id} has no code")

    after = await db.scalar(
        _ALLOCATE,
        {"company_id": company_id, "name": name, "start": START, "count": count},
    )
    first = int(after) - count
    return [format_code(company_code, name, first + i) for i in range(count)]


async def next_code(db: AsyncSession, company_id: uuid.UUID, name: str) -> str:
    """One code. The common case, and a thin wrapper so callers do not index."""
    return (await allocate(db, company_id, name, 1))[0]
