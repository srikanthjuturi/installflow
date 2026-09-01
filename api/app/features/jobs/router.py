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
from app.features.jobs.schemas import (
    CancelRequest,
    JobOfferOut,
    JobOut,
    PenaltyBandOut,
    ProofImageOut,
    ProofSubmitRequest,
)

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


# ── the technician's own jobs ────────────────────────────────────────────────
#
# These three are declared BEFORE `/{ticket_id}`. Starlette matches in
# declaration order, so a `/{ticket_id}` sitting above them would swallow
# `/jobs/mine` as a ticket id and answer 422 on a valid request.

#: The three My-jobs segments, mapped onto the ticket vocabulary.
#:
#: `Awaiting Customer` sits under **In progress**, not Completed. The technician
#: has finished, but in this product the customer closes a job — filing it as
#: complete before they have answered would be the app asserting exactly the
#: thing the confirmation link exists to establish.
SEGMENTS: dict[str, tuple[str, ...]] = {
    "upcoming": ("Assigned",),
    "inprogress": ("In Progress", "Awaiting Customer", "AI Review", "Escalated"),
    "completed": ("Closed", "Force-Closed"),
}


@router.get(
    "/mine",
    response_model=PaginatedEnvelope[JobOut],
    dependencies=[CanSeePool],
)
async def list_my_jobs(
    db: Db,
    me: TechnicianPrincipal,
    params: Annotated[ListParams, Depends(list_params)],
    status: str = "all",
) -> PaginatedEnvelope[JobOut]:
    """This technician's own jobs, unmasked, newest slot first.

    Unknown segment names are a client bug, not a filter — answering with the
    unfiltered list would quietly show a technician their completed jobs under
    "Upcoming", so an unrecognised value returns nothing instead.
    """
    principal, profile = me
    assert principal.company_id is not None
    statuses = None if status == "all" else SEGMENTS.get(status, ())
    rows, total = await service.list_mine(
        db,
        params,
        company_id=principal.company_id,
        technician_id=profile.id,
        statuses=statuses,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/today", response_model=ApiEnvelope[list[JobOut]], dependencies=[CanSeePool])
async def list_today(db: Db, me: TechnicianPrincipal) -> ApiEnvelope[list[JobOut]]:
    """Home's "Today's jobs" — this technician's slots falling today.

    Not paginated: a day's work is a handful of jobs, bounded by the daily cap,
    and Home shows all of them.
    """
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.list_today(
            db, company_id=principal.company_id, technician_id=profile.id
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


@router.post(
    "/{ticket_id}/proof",
    response_model=ApiEnvelope[JobOut],
    dependencies=[CanSeePool],
)
async def submit_proof(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID, body: ProofSubmitRequest
) -> ApiEnvelope[JobOut]:
    """Record the on-site proof and start the job.

    **400 means the set is incomplete** — all four artifact kinds are required
    and the server counts them, not the phone. **409 means the job is not in
    `Assigned`**, which is almost always a duplicate tap.
    """
    principal, profile = me
    assert principal.company_id is not None
    job = await service.submit_proof(
        db,
        ticket_id,
        company_id=principal.company_id,
        profile=profile,
        artifacts=body.artifacts,
        observed_serial=body.observedSerial,
        observed_serial_source=body.observedSerialSource,
    )
    return envelope(job, message="Job started")


@router.post(
    "/{ticket_id}/complete",
    response_model=ApiEnvelope[JobOut],
    dependencies=[CanSeePool],
)
async def complete_job(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID
) -> ApiEnvelope[JobOut]:
    """Finish the work and ask the customer to confirm it.

    This does NOT close the ticket — the customer does, through the link this
    sends. The job moves to `Awaiting Customer` and stays there until they
    answer. A WhatsApp failure is recorded on the ticket rather than raised: the
    work is done either way and ops can resend.
    """
    principal, profile = me
    assert principal.company_id is not None
    job = await service.complete(
        db, ticket_id, company_id=principal.company_id, profile=profile
    )
    return envelope(job, message="Sent to the customer to confirm")


@router.get(
    "/{ticket_id}/cancellation",
    response_model=ApiEnvelope[PenaltyBandOut],
    dependencies=[CanSeePool],
)
async def preview_cancellation(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID
) -> ApiEnvelope[PenaltyBandOut]:
    """What cancelling this job would cost, before committing to it.

    A read, so it changes nothing and can be polled while the screen is open —
    which matters, because the band moves as the slot approaches.

    **409 `JOB_NOT_CANCELLABLE`** once the job is past `Assigned`: proof has
    been captured and the technician is on site.
    """
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.cancellation_preview(
            db,
            ticket_id,
            company_id=principal.company_id,
            technician_id=profile.id,
        )
    )


@router.post(
    "/{ticket_id}/cancel",
    response_model=ApiEnvelope[PenaltyBandOut],
    dependencies=[CanSeePool],
)
async def cancel_job(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID, body: CancelRequest
) -> ApiEnvelope[PenaltyBandOut]:
    """Give the job back. The slot does not move, and the band is charged.

    Answers with what was ACTUALLY charged, which is not always what the
    preview quoted a minute earlier — the band tightens as the slot approaches,
    and the monthly cap can leave less than the band. The response is the
    receipt.

    Under the company's escalation window this also puts the ticket straight in
    front of the Area Service Manager rather than waiting for the next sweep,
    which is what the screen promises. Above it, the job simply goes back to
    the pool and every eligible technician is re-notified.
    """
    principal, profile = me
    assert principal.company_id is not None
    band = await service.cancel(
        db,
        ticket_id,
        company_id=principal.company_id,
        profile=profile,
        reason=body.reason,
    )
    return envelope(band, message="Job cancelled")


@router.get(
    "/{ticket_id}/proof",
    response_model=ApiEnvelope[list[ProofImageOut]],
    dependencies=[CanSeePool],
)
async def list_proof(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID
) -> ApiEnvelope[list[ProofImageOut]]:
    """This technician's own proof for their own job, with signed links.

    404 unless the job is theirs — the same boundary as the detail read. The
    links expire in minutes; the caller re-reads rather than caching them.
    """
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.list_proof(
            db, ticket_id, company_id=principal.company_id, technician_id=profile.id
        )
    )


@router.get(
    "/{ticket_id}",
    response_model=ApiEnvelope[JobOut],
    dependencies=[CanSeePool],
)
async def get_job(
    db: Db, me: TechnicianPrincipal, ticket_id: uuid.UUID
) -> ApiEnvelope[JobOut]:
    """One of this technician's own jobs. 404 unless it is theirs.

    Declared last, so `/mine` and `/today` are matched as literals first.
    """
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.get_job(
            db, ticket_id, company_id=principal.company_id, technician_id=profile.id
        )
    )
