"""Which jobs a technician has passed — read by the pool AND by the push.

In `core` because two places must agree on it and they are not in one slice:
`jobs.service.pool_query` hides a passed job, and `core.push.announce_pool_job`
must not ring a phone about a job its pool will not show. `core.coverage` warns
that any new pool condition belongs on both sides; this is that condition, with
one definition.

A pass counts only while the ticket still carries the slot and bonus it was
passed on — the reasoning is on `models.job_pass`. `IS NOT DISTINCT FROM`
rather than `=`, because NULL is a real value in both columns ("no time yet",
"no bonus") and `NULL = NULL` is not true.
"""

import uuid

from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_pass import JobPass
from app.models.ticket import Ticket


def _same_terms() -> ColumnElement[bool]:
    return and_(
        JobPass.slot_start.is_not_distinct_from(Ticket.slot_start),
        JobPass.bonus_paise.is_not_distinct_from(Ticket.bonus_paise),
    )


def passed_as_offered(
    *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> ColumnElement[bool]:
    """EXISTS: this technician passed the OUTER `Ticket` on the terms it has now.

    Correlates to the enclosing `select(Ticket)`, like `has_cap_room`, so it
    drops straight into `pool_query`'s WHERE clause. One probe of
    `uq_job_passes_ticket_technician`.
    """
    return (
        select(JobPass.id)
        .where(
            JobPass.company_id == company_id,
            JobPass.technician_id == technician_id,
            JobPass.ticket_id == Ticket.id,
            _same_terms(),
        )
        .exists()
    )


async def technicians_who_passed(
    db: AsyncSession, *, company_id: uuid.UUID, ticket_id: uuid.UUID
) -> set[uuid.UUID]:
    """Profile ids whose pass on this ticket still stands."""
    rows = await db.scalars(
        select(JobPass.technician_id)
        .join(
            Ticket,
            and_(Ticket.company_id == JobPass.company_id, Ticket.id == JobPass.ticket_id),
        )
        .where(
            JobPass.company_id == company_id,
            JobPass.ticket_id == ticket_id,
            _same_terms(),
        )
    )
    return set(rows)
