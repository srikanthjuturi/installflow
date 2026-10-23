"""The franchisee's technician endpoints — the `/franchise` twins.

Task 05's portal door: a franchisee's own admin reaches ITS technicians —
roster, invites, UPI changes — through `require_franchise_principal` (the role
test Task 02 defined) AND a `franchise.*` feature key, and never through the
staff `/technicians` routes, which now refuse a franchise principal. Authority
comes from the relationship, not the feature: the guard is why the feature
override cannot hand the door to somebody else, and the guard is also why it
cannot be opened wider — the principal is pinned to its franchisee in
`core.deps` (F7).

⚠ No `require_min_rank` on ANY route here (§8 trap 4): a franchisee admin
ranks below every staff role, so a floor would be a silent 403 for the one
audience this router exists for.

Route order matters, the same trap the staff router documents: the literal
segments `/invites` and `/upi-changes` are declared BEFORE `/{technician_id}`,
or FastAPI matches them as an id and answers 422.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.base_location import BaseLocationIn
from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_franchise_principal
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
    AppLinkOutcome,
    InviteCreateRequest,
    TechnicianCreatedOut,
    TechnicianCreateRequest,
    TechnicianDetailOut,
    TechnicianInviteOut,
    TechnicianRowOut,
    TechnicianUpdateRequest,
    UpiChangeCountOut,
    UpiChangeOut,
    UpiChangeRequestIn,
    UpiChangeRowOut,
    UpiRejectRequest,
)

router = APIRouter(prefix="/franchise", tags=["franchise"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: `franchise.technicians` — the roster, its invites and its app links. Both
#: guards, always: the role test pins WHO may hold the door, the feature key
#: says whether the company has opened it.
CanTech = Annotated[
    Principal,
    Depends(require_franchise_principal),
    Depends(require_feature("franchise.technicians")),
]
#: `franchise.payouts` — where somebody's money lands, and who decides when they
#: move it. A different key from the roster, because adding a technician and
#: redirecting their pay are different decisions.
CanPay = Annotated[
    Principal,
    Depends(require_franchise_principal),
    Depends(require_feature("franchise.payouts")),
]


@router.get("/technicians", response_model=PaginatedEnvelope[TechnicianRowOut])
async def list_technicians(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanTech,
    view: Annotated[str, Query(pattern="^(all|registered|invites)$")] = "all",
    status: Annotated[str | None, Query()] = None,
    onboarding: Annotated[str | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    subcategoryId: Annotated[uuid.UUID | None, Query()] = None,
    pincode: Annotated[str | None, Query(pattern="^[0-9]{6}$")] = None,
    districtId: Annotated[uuid.UUID | None, Query()] = None,
    onboardingMode: Annotated[str | None, Query()] = None,
    onDay: Annotated[datetime.datetime | None, Query()] = None,
    technicianType: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[TechnicianRowOut]:
    """This franchisee's technicians and invites — the staff list, pinned.

    Same params and the same response bodies, minus `franchiseeId`: the portal
    does not pick a franchisee, because it IS one. The scope in
    `core.franchise_scope` already pins every row to the principal's franchisee.
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
        district_id=districtId,
        onboarding_mode=onboardingMode,
        on_day=onDay,
        technician_type=technicianType,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/technicians", response_model=ApiEnvelope[TechnicianCreatedOut], status_code=201
)
async def create_technician(
    body: TechnicianCreateRequest, db: Db, principal: CanTech
) -> ApiEnvelope[TechnicianCreatedOut]:
    """Add one of your own. 201 whether or not the app link reached them.

    `regionId` is optional here — with only this franchisee's pincodes assigned,
    one region usually holds them all and the service derives it; coverage
    outside the franchisee is refused 422 `PINCODE_OUTSIDE_FRANCHISEE`.
    """
    data = await service.create_technician(db, principal, body)
    message = (
        "Technician added"
        if data.appLinkStatus == "sent"
        else "Technician added, but the app link was not delivered"
    )
    return envelope(data, message=message, status_code=201)


@router.post(
    "/technicians/invites", response_model=ApiEnvelope[TechnicianInviteOut], status_code=201
)
async def create_invite(
    body: InviteCreateRequest, db: Db, principal: CanTech
) -> ApiEnvelope[TechnicianInviteOut]:
    """Invite a phone into your franchisee; 201 even when WhatsApp refuses."""
    invite = await service.create_invite(db, principal, body)
    message = "Invite sent" if invite.status == "sent" else "Invite saved, but not delivered"
    return envelope(invite, message=message, status_code=201)


@router.post(
    "/technicians/invites/{invite_id}/resend",
    response_model=ApiEnvelope[TechnicianInviteOut],
)
async def resend_invite(
    invite_id: uuid.UUID, db: Db, principal: CanTech
) -> ApiEnvelope[TechnicianInviteOut]:
    invite = await service.resend_invite(db, principal, invite_id)
    message = "Invite resent" if invite.status == "sent" else "Still not delivered"
    return envelope(invite, message=message)


@router.delete(
    "/technicians/invites/{invite_id}", response_model=ApiEnvelope[None]
)
async def cancel_invite(
    invite_id: uuid.UUID, db: Db, principal: CanTech
) -> ApiEnvelope[None]:
    await service.cancel_invite(db, principal, invite_id)
    return envelope(None, message="Invite cancelled")


@router.post(
    "/technicians/{technician_id}/app-link", response_model=ApiEnvelope[AppLinkOutcome]
)
async def send_app_link(
    technician_id: uuid.UUID, db: Db, principal: CanTech
) -> ApiEnvelope[AppLinkOutcome]:
    """WhatsApp the app link again. Same send the staff door offers."""
    data = await service.resend_app_link(db, principal, technician_id)
    message = "App link sent" if data.appLinkStatus == "sent" else "App link not delivered"
    return envelope(data, message=message)


@router.get(
    "/technicians/{technician_id}", response_model=ApiEnvelope[TechnicianDetailOut]
)
async def get_technician(
    technician_id: uuid.UUID, db: Db, principal: CanTech
) -> ApiEnvelope[TechnicianDetailOut]:
    """One of your technicians. Outside the franchisee — 404, never 403."""
    return envelope(await service.get_technician(db, principal, technician_id))


@router.put(
    "/technicians/{technician_id}", response_model=ApiEnvelope[TechnicianDetailOut]
)
async def update_technician(
    technician_id: uuid.UUID,
    body: TechnicianUpdateRequest,
    db: Db,
    principal: CanTech,
) -> ApiEnvelope[TechnicianDetailOut]:
    """Edit one. A type change 409s `TECHNICIAN_HAS_OPEN_JOBS` while a job is open."""
    data = await service.update_technician(db, principal, technician_id, body)
    return envelope(data, message="Technician updated")


@router.put(
    "/technicians/{technician_id}/base-location",
    response_model=ApiEnvelope[TechnicianDetailOut],
)
async def set_base_location(
    technician_id: uuid.UUID,
    body: BaseLocationIn,
    db: Db,
    principal: CanTech,
) -> ApiEnvelope[TechnicianDetailOut]:
    """Set or move one of your technicians' base, from their profile screen.

    The franchisee twin of the staff route above it — the whole `MANAGER_SOURCES`
    set (W8), the same place-not-shape refusals, and the same `_load` wall the
    profile behind it uses, so a technician of another franchisee is 404, never
    a leak.
    """
    return envelope(
        await service.set_base_location(db, principal, technician_id, body),
        message="Base location saved",
    )


@router.delete("/technicians/{technician_id}", response_model=ApiEnvelope[None])
async def delete_technician(
    technician_id: uuid.UUID, db: Db, principal: CanTech
) -> ApiEnvelope[None]:
    """Remove one. 409 `TECHNICIAN_HAS_OPEN_JOBS` while a job is still open."""
    await service.delete_technician(db, principal, technician_id)
    return envelope(None, message="Technician removed")


# ── UPI changes — this franchisee's money-routing queue ───────────────────────


@router.get(
    "/technicians/{technician_id}/upi-change",
    response_model=ApiEnvelope[UpiChangeOut | None],
)
async def get_upi_change(
    technician_id: uuid.UUID, db: Db, principal: CanPay
) -> ApiEnvelope[UpiChangeOut | None]:
    """The change waiting on this technician, or null."""
    return envelope(await service.get_upi_change(db, principal, technician_id))


@router.post(
    "/technicians/{technician_id}/upi-change/approve",
    response_model=ApiEnvelope[UpiChangeOut],
)
async def approve_upi_change(
    technician_id: uuid.UUID, db: Db, principal: CanPay
) -> ApiEnvelope[UpiChangeOut]:
    """Apply the new UPI ID and name. No code — the franchisee admin is the check.

    409 `NO_PENDING_CHANGE` when it was withdrawn or already decided.
    """
    return envelope(
        await service.approve_upi_change(db, principal, technician_id),
        message="UPI ID changed",
    )


@router.post(
    "/technicians/{technician_id}/upi-change/reject",
    response_model=ApiEnvelope[UpiChangeOut],
)
async def reject_upi_change(
    technician_id: uuid.UUID, body: UpiRejectRequest, db: Db, principal: CanPay
) -> ApiEnvelope[UpiChangeOut]:
    """Refuse it, with a reason the technician reads. Their UPI ID stays."""
    return envelope(
        await service.reject_upi_change(db, principal, technician_id, body),
        message="Change rejected",
    )


@router.get("/upi-changes", response_model=PaginatedEnvelope[UpiChangeRowOut])
async def list_upi_changes(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanPay,
    state: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[UpiChangeRowOut]:
    """This franchisee's change requests — the Payouts tab's lists.

    `state` ∈ `pending` (oldest first — a queue) / `approved` / `rejected`
    (newest first); absent, everything, newest first. Unknown → empty page.
    """
    rows, total = await service.list_upi_changes(db, principal, params, state=state)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/upi-changes/count", response_model=ApiEnvelope[UpiChangeCountOut])
async def count_pending_upi_changes(
    db: Db, principal: CanPay
) -> ApiEnvelope[UpiChangeCountOut]:
    """How many are waiting on this franchisee."""
    return envelope(await service.count_pending_upi_changes(db, principal))