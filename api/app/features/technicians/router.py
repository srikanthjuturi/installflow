"""Technician endpoints — the ops console side of both onboarding modes.

Route order matters: `/invites` and `/me` are declared BEFORE
`/{technician_id}`, or FastAPI matches the literal against `uuid.UUID` and
answers 422 instead of running the handler.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CompanyPrincipal, Principal, require_feature
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.technicians import service
from app.features.technicians.schemas import (
    AvailabilityOut,
    AvailabilityRequest,
    InviteCreateRequest,
    TechnicianCreateRequest,
    TechnicianDetailOut,
    TechnicianInviteOut,
    TechnicianRowOut,
    TechnicianSessionOut,
    TechnicianUpdateRequest,
)

router = APIRouter(prefix="/technicians", tags=["technicians"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanView = Annotated[Principal, Depends(require_feature("technicians.view"))]
CanCreate = Annotated[Principal, Depends(require_feature("technicians.create"))]
CanInvite = Annotated[Principal, Depends(require_feature("technicians.invite"))]
CanEdit = Annotated[Principal, Depends(require_feature("technicians.edit"))]


@router.get("/me", response_model=ApiEnvelope[TechnicianSessionOut])
async def get_my_technician_profile(
    db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[TechnicianSessionOut]:
    """A technician reading their own profile.

    No feature guard: the seeded defaults give `technician` dashboard/jobs/pool,
    NOT `technicians.view`, so gating this would 403 every technician against
    their own record.
    """
    return envelope(await service.get_me(db, principal))


@router.patch("/me/availability", response_model=ApiEnvelope[AvailabilityOut])
async def set_my_availability(
    db: Db, principal: CompanyPrincipal, body: AvailabilityRequest
) -> ApiEnvelope[AvailabilityOut]:
    """A technician saying whether they want work.

    No feature guard, for the same reason `/me` has none: the seeded technician
    role does not carry `technicians.edit`, so gating this would 403 every
    technician against their own availability.

    Only the caller's own row is reachable — the profile is resolved from the
    principal, and there is no id in the path to guess at.
    """
    return envelope(
        await service.set_availability(
            db, principal, accepting_work=body.acceptingWork
        ),
        message="Availability updated",
    )


@router.post(
    "/invites", response_model=ApiEnvelope[TechnicianInviteOut], status_code=201
)
async def create_invite(
    body: InviteCreateRequest, db: Db, principal: CanInvite
) -> ApiEnvelope[TechnicianInviteOut]:
    """201 even when WhatsApp refuses.

    The row exists and can be resent, and the link is in the response for a
    manager to send by hand — that is a better outcome than a 5xx and no record.
    """
    invite = await service.create_invite(db, principal, body)
    message = "Invite sent" if invite.status == "sent" else "Invite saved, but not delivered"
    return envelope(invite, message=message, status_code=201)


@router.post(
    "/invites/{invite_id}/resend", response_model=ApiEnvelope[TechnicianInviteOut]
)
async def resend_invite(
    invite_id: uuid.UUID, db: Db, principal: CanInvite
) -> ApiEnvelope[TechnicianInviteOut]:
    invite = await service.resend_invite(db, principal, invite_id)
    message = "Invite resent" if invite.status == "sent" else "Still not delivered"
    return envelope(invite, message=message)


@router.delete("/invites/{invite_id}", response_model=ApiEnvelope[None])
async def cancel_invite(
    invite_id: uuid.UUID, db: Db, principal: CanInvite
) -> ApiEnvelope[None]:
    await service.cancel_invite(db, principal, invite_id)
    return envelope(None, message="Invite cancelled")


@router.get("", response_model=PaginatedEnvelope[TechnicianRowOut])
async def list_technicians(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanView,
    view: Annotated[str, Query(pattern="^(all|registered|invites)$")] = "all",
    status: Annotated[str | None, Query()] = None,
    onboarding: Annotated[str | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    subcategoryId: Annotated[uuid.UUID | None, Query()] = None,
    pincode: Annotated[str | None, Query(pattern="^[0-9]{6}$")] = None,
    onboardingMode: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[TechnicianRowOut]:
    """Registered technicians and open invites in one list.

    They are one person at two lifecycle stages, so splitting them across two
    endpoints would put the same question — "is this number onboarded?" — in
    two places, and give a page size that is neither list's.
    """
    rows, total = await service.list_technicians(
        db,
        principal,
        params,
        view=view,
        tech_status=status,
        invite_status=onboarding,
        region_id=regionId,
        subcategory_id=subcategoryId,
        pincode=pincode,
        onboarding_mode=onboardingMode,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post("", response_model=ApiEnvelope[TechnicianDetailOut], status_code=201)
async def create_technician(
    body: TechnicianCreateRequest, db: Db, principal: CanCreate
) -> ApiEnvelope[TechnicianDetailOut]:
    data = await service.create_technician(db, principal, body)
    return envelope(data, message="Technician added", status_code=201)


@router.get("/{technician_id}", response_model=ApiEnvelope[TechnicianDetailOut])
async def get_technician(
    technician_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[TechnicianDetailOut]:
    return envelope(await service.get_technician(db, principal, technician_id))


@router.put("/{technician_id}", response_model=ApiEnvelope[TechnicianDetailOut])
async def update_technician(
    technician_id: uuid.UUID,
    body: TechnicianUpdateRequest,
    db: Db,
    principal: CanEdit,
) -> ApiEnvelope[TechnicianDetailOut]:
    data = await service.update_technician(db, principal, technician_id, body)
    return envelope(data, message="Technician updated")


@router.delete("/{technician_id}", response_model=ApiEnvelope[None])
async def delete_technician(
    technician_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    await service.delete_technician(db, principal, technician_id)
    return envelope(None, message="Technician removed")
