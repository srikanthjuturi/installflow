"""Who covers a job — the inverse of the pool query.

`jobs.service.pool_query` asks "which tickets may THIS technician be offered".
This asks the other direction: given a ticket that has just entered the pool,
who should hear about it. Same two facts, read the other way round.

In `core` because both the jobs slice and the tickets slice put tickets into the
pool — `publish_pool_changed` is called from each — and slices never import each
other (hard rule 4). It sits beside `core.scope`, which was promoted here for
exactly the same reason: a rule two slices need is a rule that must have one
copy, or the second one drifts.

## It must agree with `pool_query`, and that is the whole risk

A technician pushed about a job the pool will not show them opens the app to
nothing. The two predicates that decide it — covers the pincode, certified for
the subcategory — are duplicated here rather than shared, because the two
queries are shaped differently: one correlates against `Ticket` columns, this
one against literals. If a THIRD condition is ever added to pool eligibility,
it belongs in both, and this note is where whoever adds it should look.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.technician import (
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)


async def technicians_covering(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    pincode: str,
    subcategory_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Technician profile ids eligible to be offered this job.

    Only technicians who are ONLINE. Going offline is the app's way of saying
    "do not offer me work", and a push that ignored it would make the toggle a
    lie — the one setting a technician uses to protect their evening.

    Returns profile ids, which is what `push_tokens.technician_id` keys on.
    """
    covers_pincode = (
        select(TechnicianPincode.id)
        .where(
            TechnicianPincode.company_id == company_id,
            TechnicianPincode.technician_id == TechnicianProfile.id,
            TechnicianPincode.pincode == pincode,
        )
        .exists()
    )
    certified_for = (
        select(TechnicianSubcategory.id)
        .where(
            TechnicianSubcategory.company_id == company_id,
            TechnicianSubcategory.technician_id == TechnicianProfile.id,
            TechnicianSubcategory.subcategory_id == subcategory_id,
        )
        .exists()
    )

    return list(
        await db.scalars(
            select(TechnicianProfile.id).where(
                TechnicianProfile.company_id == company_id,
                # `status`, not a soft-delete column — this table has none.
                # A suspended technician keeps their coverage rows, so
                # filtering on coverage alone would still reach them.
                TechnicianProfile.status == "active",
                TechnicianProfile.accepting_work.is_(True),
                covers_pincode,
                certified_for,
            )
        )
    )
