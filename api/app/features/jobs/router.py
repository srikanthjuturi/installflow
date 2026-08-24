"""The technician's own surface: the pool, one offer, and taking it.

Separate from the tickets slice rather than three more routes on it, because
the two answer different questions about the same rows. `/tickets` is the ops
view — who raised it, where it is, the full customer record — scoped by
TERRITORY. `/jobs` is the field view: what a technician could go and do,
scoped by their own COVERAGE, with the customer masked until they commit.
Bolting the second onto the first would have meant one endpoint whose response
shape and visibility rule both forked on the caller's role, which is how a
masked field eventually gets returned to the wrong person.

Every route carries **two** guards, and both are load-bearing:

  * `pool.view` — hard rule 2, every endpoint carries a feature key, and the
    console reads it to decide what to render. It has been seeded to the
    technician role since the initial migration and read by nothing until now.
  * `require_technician_principal` — because a feature grant is overridable per
    company through Feature Access, so `pool.view` alone would mean "technician
    only" lasted until an admin handed the key to an ops user. It also resolves
    the profile row, which is what every query below actually keys on.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import TechnicianPrincipal, require_feature
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.jobs import service
from app.features.jobs.schemas import JobOfferOut, JobOut

router = APIRouter(prefix="/jobs", tags=["jobs"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanSeePool = Depends(require_feature("pool.view"))


@router.get(
    "/pool",
    response_model=PaginatedEnvelope[JobOfferOut],
    dependencies=[CanSeePool],
)
async def list_pool(
    db: Db,
    me: TechnicianPrincipal,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[JobOfferOut]:
    """Confirmed slots this technician could take — soonest first.

    Empty is a normal answer, not an error: it means every nearby job is taken,
    which is what the screen's "Pool is empty" state says.
    """
    principal, profile = me
    assert principal.company_id is not None  # CompanyPrincipal guarantees it
    rows, total = await service.list_pool(
        db, params, company_id=principal.company_id, technician_id=profile.id
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/pool/{ticket_id}",
    response_model=ApiEnvelope[JobOfferOut],
    dependencies=[CanSeePool],
)
async def get_offer(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID
) -> ApiEnvelope[JobOfferOut]:
    """One masked offer. 404 unless it is in THIS technician's pool."""
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.get_offer(
            db, ticket_id, company_id=principal.company_id, technician_id=profile.id
        )
    )


@router.post(
    "/{ticket_id}/accept",
    response_model=ApiEnvelope[JobOut],
    dependencies=[CanSeePool],
)
async def accept_job(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID
) -> ApiEnvelope[JobOut]:
    """Commit to the slot, and unlock the customer's details.

    **409 means somebody else got there first**, and that is a normal outcome
    of first-accept-wins rather than a failure — the app has a screen for it.
    """
    principal, profile = me
    assert principal.company_id is not None
    job = await service.accept(
        db, ticket_id, company_id=principal.company_id, profile=profile
    )
    return envelope(job, message="Job accepted")
