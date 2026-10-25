"""Technician endpoints — the ops console side of both onboarding modes.

Route order matters: `/invites` and `/me` are declared BEFORE
`/{technician_id}`, or FastAPI matches the literal against `uuid.UUID` and
answers 422 instead of running the handler.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.base_location import BaseLocationIn, BaseLocationOut
from app.core.database import get_db
from app.core.deps import (
    CompanyPrincipal,
    Principal,
    require_all,
    require_feature,
    require_min_rank,
    require_staff_principal,
)
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.auth.schemas import OtpRequestResponse
from app.features.technicians import service, transfer_service
from app.models.role import AREA_MANAGER, NATIONAL_HEAD
from app.features.technicians.schemas import (
    AppLinkOutcome,
    AvailabilityOut,
    AvailabilityRequest,
    DeletionConfirmRequest,
    PayoutAccountCodeRequest,
    PayoutAccountOut,
    PayoutAccountRequest,
    PayoutAccountVerifyRequest,
    UpiChangeOut,
    UpiChangeRequestIn,
    UpiRejectRequest,
    DistrictBreakdownOut,
    InviteCreateRequest,
    TechnicianCreatedOut,
    TechnicianCreateRequest,
    TechnicianDetailOut,
    TechnicianInviteOut,
    TechnicianRowOut,
    TechnicianSessionOut,
    TechnicianTransferOut,
    TechnicianTransferRequest,
    TechnicianTransferRowOut,
    TechnicianUpdateRequest,
)

router = APIRouter(prefix="/technicians", tags=["technicians"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: Staff console guards. Task 05 adds `require_staff_principal` everywhere a
#: feature key is checked: these routes manage PEOPLE and MONEY, and since this
#: task a franchisee admin reaches those facts through its OWN `/franchise`
#: twins — a feature override must not be able to hand a company's roster to
#: the wrong family (`require_staff_principal` refuses franchise, vendor and
#: technician principals alike).
CanView = Annotated[
    Principal,
    Depends(
        require_all(
            require_staff_principal,
            require_feature("technicians.view"),
        )
    ),
]
CanCreate = Annotated[
    Principal,
    Depends(
        require_all(
            require_staff_principal,
            require_feature("technicians.create"),
        )
    ),
]
CanInvite = Annotated[
    Principal,
    Depends(
        require_all(
            require_staff_principal,
            require_feature("technicians.invite"),
        )
    ),
]
CanEdit = Annotated[
    Principal,
    Depends(
        require_all(
            require_staff_principal,
            require_feature("technicians.edit"),
        )
    ),
]


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


@router.get(
    "/me/base-location", response_model=ApiEnvelope[BaseLocationOut | None]
)
async def get_my_base_location(
    db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[BaseLocationOut | None]:
    """Where you start from, or null — the Profile screen and the Home card.

    No feature guard, for the reason `/me` has none — a feature key would 403
    every technician against their own record.
    """
    return envelope(await service.get_my_base_location(db, principal))


@router.put(
    "/me/base-location", response_model=ApiEnvelope[BaseLocationOut]
)
async def set_my_base_location(
    db: Db, principal: CompanyPrincipal, body: BaseLocationIn
) -> ApiEnvelope[BaseLocationOut]:
    """Set or move your own base. PUT only — it replaces; no DELETE, because a
    base can be moved, not removed.

    A pincode must be inside your franchisee's range (W9), for everybody —
    outside it, drop a map pin instead (422 `PINCODE_OUTSIDE_FRANCHISEE`). A
    pin without coordinates is 400 `PINCODE_HAS_NO_LOCATION`, and a point
    outside India is 400 `BASE_OUTSIDE_INDIA` — the place, not the shape. No
    approval and no cooldown (R9); what you set shows on your console row.
    """
    return envelope(
        await service.set_my_base_location(db, principal, body),
        message="Base location saved",
    )


@router.patch("/me/availability", response_model=ApiEnvelope[AvailabilityOut])
async def set_my_availability(
    db: Db, principal: CompanyPrincipal, body: AvailabilityRequest
) -> ApiEnvelope[AvailabilityOut]:
    """A technician saying whether they want work, and how much of it.

    Both halves of the Availability & bandwidth screen. The daily cap lives here
    rather than on its own route because it is the same decision — how much work
    am I taking — saved from the same screen; a second endpoint would be two
    round trips and two failure modes for one action.

    Until this accepted a cap there was no way for a technician to set their
    own at all: `PUT /technicians/{id}` requires `technicians.edit`, which the
    seeded technician role does not hold. The joining flow's own docstring
    already promised "a technician sets their own cap afterwards, in the app's
    Availability screen" — an endpoint that did not exist.

    No feature guard, for the same reason `/me` has none: gating this would 403
    every technician against their own availability.

    Only the caller's own row is reachable — the profile is resolved from the
    principal, and there is no id in the path to guess at.
    """
    return envelope(
        await service.set_availability(db, principal, body),
        message="Availability updated",
    )


@router.patch("/me/payout-account", response_model=ApiEnvelope[PayoutAccountOut])
async def set_my_payout_account(
    db: Db, principal: CompanyPrincipal, body: PayoutAccountRequest
) -> ApiEnvelope[PayoutAccountOut]:
    """The old free edit — now always 409 `UPDATE_APP`. See the service."""
    return envelope(await service.set_payout_account(db, principal, body))


# ── the technician's own UPI ID ───────────────────────────────────────────────
#
# Add ONCE, proved by a WhatsApp code to the technician's registered number;
# after that, ask a manager to change it. No feature guard on any of these, for
# the reason `/me` has none — the seeded technician role holds no
# `technicians.*` key — and only the caller's own row is reachable: the profile
# comes from the bearer token and there is no id in any path.


@router.get("/me/payout-account", response_model=ApiEnvelope[PayoutAccountOut])
async def get_my_payout_account(
    db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[PayoutAccountOut]:
    """The UPI ID and name on file, and the latest change request if any."""
    return envelope(await service.get_payout_account(db, principal))


@router.post("/me/payout-account/code", response_model=ApiEnvelope[OtpRequestResponse])
async def send_my_payout_code(
    request: Request, db: Db, principal: CompanyPrincipal, body: PayoutAccountCodeRequest
) -> ApiEnvelope[OtpRequestResponse]:
    """Step one of adding a UPI ID: a code to the technician's own WhatsApp.

    409 `UPI_ALREADY_SET` once one is on file — changing it is a request. The
    OTP throttles apply, so a 429 is normal and says how long to wait.
    """
    return envelope(
        await service.send_payout_code(
            db,
            principal,
            body,
            request_ip=request.client.host if request.client else None,
        ),
        message="Code sent",
    )


@router.post("/me/payout-account", response_model=ApiEnvelope[PayoutAccountOut])
async def verify_my_payout_account(
    db: Db, principal: CompanyPrincipal, body: PayoutAccountVerifyRequest
) -> ApiEnvelope[PayoutAccountOut]:
    """Step two: the code, and the UPI ID and name to save.

    400 `BAD_CODE` for a wrong or expired code — never 401, which the app would
    read as an expired session and replay.
    """
    return envelope(
        await service.verify_payout_account(db, principal, body),
        message="UPI ID added",
    )


@router.post(
    "/me/payout-account/change-request", response_model=ApiEnvelope[PayoutAccountOut]
)
async def request_my_upi_change(
    db: Db, principal: CompanyPrincipal, body: UpiChangeRequestIn
) -> ApiEnvelope[PayoutAccountOut]:
    """Propose a new UPI ID and name. The manager for their area decides."""
    return envelope(
        await service.request_upi_change(db, principal, body),
        message="Change requested",
    )


@router.delete(
    "/me/payout-account/change-request", response_model=ApiEnvelope[PayoutAccountOut]
)
async def withdraw_my_upi_change(
    db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[PayoutAccountOut]:
    """Take back a change nobody has decided yet."""
    return envelope(
        await service.withdraw_upi_change(db, principal),
        message="Change withdrawn",
    )


# ── a technician deleting their own account ───────────────────────────────────
#
# The Play Store requires this. Proved by a code to the technician's OWN
# registered number, same shape as adding a UPI ID; no feature guard, for the
# reason `/me` has none, and only the caller's own row is ever touched.


@router.post(
    "/me/deletion-request/code", response_model=ApiEnvelope[OtpRequestResponse]
)
async def send_my_deletion_code(
    request: Request, db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[OtpRequestResponse]:
    """Step one of deleting your own account: a code to your own WhatsApp.

    409 `TECHNICIAN_HAS_OPEN_JOBS` while a job is still open — finish or ask a
    manager to reassign it first.
    """
    return envelope(
        await service.send_deletion_code(
            db,
            principal,
            request_ip=request.client.host if request.client else None,
        ),
        message="Code sent",
    )


@router.post("/me/deletion-request", response_model=ApiEnvelope[None])
async def confirm_my_deletion(
    db: Db, principal: CompanyPrincipal, body: DeletionConfirmRequest
) -> ApiEnvelope[None]:
    """Step two: the code, then the account is removed immediately.

    400 `BAD_CODE` for a wrong or expired code — never 401, which the app
    would read as an expired session and replay.
    """
    await service.confirm_deletion(db, principal, body)
    return envelope(None, message="Account deleted")


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
    districtId: Annotated[uuid.UUID | None, Query()] = None,
    onboardingMode: Annotated[str | None, Query()] = None,
    onDay: Annotated[datetime.datetime | None, Query()] = None,
    franchiseeId: Annotated[uuid.UUID | None, Query()] = None,
    technicianType: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[TechnicianRowOut]:
    """Registered technicians and open invites in one list.

    They are one person at two lifecycle stages, so splitting them across two
    endpoints would put the same question — "is this number onboarded?" — in
    two places, and give a page size that is neither list's.

    `onDay` changes which day `bwUsed` counts and nothing else — no row appears
    or disappears because of it. The assignment shortlist sends the ticket's own
    slot, so the capacity it shows is capacity on the day the work happens; a
    Friday job otherwise reports Monday's load and the manager picks somebody
    the assign call then refuses at cap.

    `franchiseeId`/`technicianType` narrow the roster by franchisee and pay type
    (Task 05). An unknown type answers an empty page, never a 422 — a filter in
    a shareable query string may be stale.
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
        franchisee_id=franchiseeId,
        technician_type=technicianType,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/districts", response_model=ApiEnvelope[DistrictBreakdownOut])
async def district_breakdown(
    db: Db,
    principal: CanView,
    stateId: Annotated[uuid.UUID, Query()],
) -> ApiEnvelope[DistrictBreakdownOut]:
    """Technicians per district for one state.

    Declared above `/{technician_id}`, like `/me` and `/invites` — otherwise
    the path matches as an id and answers 422 for a technician called
    "districts".

    The counts do NOT sum to `totalTechnicians`, and that is the geography, not
    a bug: a pincode can belong to four districts at once. See the service.
    """
    data = await service.district_breakdown(db, principal, stateId)
    return envelope(data, message="Technicians by district")


@router.post("", response_model=ApiEnvelope[TechnicianCreatedOut], status_code=201)
async def create_technician(
    body: TechnicianCreateRequest, db: Db, principal: CanCreate
) -> ApiEnvelope[TechnicianCreatedOut]:
    """201 whether or not the app link reached them — like an invite.

    The technician exists either way; `appLinkStatus` says whether WhatsApp
    took the message, and the link comes back for a manager to send by hand.
    """
    data = await service.create_technician(db, principal, body)
    message = (
        "Technician added"
        if data.appLinkStatus == "sent"
        else "Technician added, but the app link was not delivered"
    )
    return envelope(data, message=message, status_code=201)


@router.post(
    "/{technician_id}/app-link", response_model=ApiEnvelope[AppLinkOutcome]
)
async def send_app_link(
    technician_id: uuid.UUID, db: Db, principal: CanCreate
) -> ApiEnvelope[AppLinkOutcome]:
    """WhatsApp a registered technician the app link again.

    `technicians.create`, the grant that sent it the first time. Writes nothing
    — the outcome is reported, not stored — which is why it needs no edit grant.
    """
    data = await service.resend_app_link(db, principal, technician_id)
    message = "App link sent" if data.appLinkStatus == "sent" else "App link not delivered"
    return envelope(data, message=message)


# ── moving a technician between franchisees (Task 17) ─────────────────────────
#
# Every guard is in `dependencies=[...]` and NEVER stacked inside one `Annotated`
# alias: FastAPI applies only the LAST `Depends` of an `Annotated`, so the stacked
# `CanView`/`CanEdit` aliases above silently skip `require_staff_principal`.
# Here `franchisees.manage` (Admin / NH by default), the National-Head floor (a
# Feature Access override cannot lift it) and the staff-only door all actually
# run. Declared after the literal `/invites…` routes and before `/{technician_id}`.


@router.post(
    "/{technician_id}/transfer",
    response_model=ApiEnvelope[TechnicianTransferOut],
    dependencies=[
        Depends(require_feature("franchisees.manage")),
        Depends(require_min_rank(NATIONAL_HEAD)),
        Depends(require_staff_principal),
    ],
)
async def transfer_technician(
    technician_id: uuid.UUID,
    body: TechnicianTransferRequest,
    db: Db,
    principal: CompanyPrincipal,
    dryRun: Annotated[bool, Query()] = False,
) -> ApiEnvelope[TechnicianTransferOut]:
    """Move a technician to another franchisee, or preview the move (`?dryRun=true`).

    `franchisees.manage` + a National-Head floor - NOT `_load_managed`, which
    would 403 every non-home technician for an Admin/NH. A dry run answers 200
    with the blockers as DATA and writes nothing; an apply raises the first one
    (409 `TECHNICIAN_HAS_OPEN_JOBS` / `TECHNICIAN_HAS_BALANCE` /
    `FRANCHISEE_HAS_NO_ADMIN`, code-less 409 for "already works for" and
    "inactive", 422 `PINCODE_OUTSIDE_FRANCHISEE`, 422 for a missing reason or
    coverage across two regions). Another company's technician or franchisee is
    a 404. History stays where it was earned: no ticket, ledger entry or
    redemption is touched.
    """
    data = await transfer_service.transfer_technician(
        db, principal, technician_id, body, dry_run=dryRun
    )
    return envelope(
        data, message="Preview — nothing was saved" if dryRun else "Technician moved"
    )


@router.get(
    "/{technician_id}/transfers",
    response_model=ApiEnvelope[list[TechnicianTransferRowOut]],
    dependencies=[
        Depends(require_feature("technicians.view")),
        Depends(require_staff_principal),
    ],
)
async def list_transfers(
    technician_id: uuid.UUID, db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[list[TechnicianTransferRowOut]]:
    """Every time this technician changed franchisee, newest first. Staff only
    (D11): the reason is the company's note about a franchisee. The same `_load`
    wall as the profile, so an Area Manager reads the history of technicians in
    their scope and anything else is a 404."""
    return envelope(await transfer_service.list_transfers(db, principal, technician_id))


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


@router.put(
    "/{technician_id}/base-location",
    response_model=ApiEnvelope[TechnicianDetailOut],
)
async def set_base_location(
    technician_id: uuid.UUID,
    body: BaseLocationIn,
    db: Db,
    principal: CanEdit,
) -> ApiEnvelope[TechnicianDetailOut]:
    """Set or move a technician's base for them, from their profile screen.

    The manager twin of `PUT /technicians/me/base-location`: a map pin or a
    pincode, the whole `MANAGER_SOURCES` set (W8) — a technician's own edit
    refuses "manual", the one source meaning somebody else recorded it. Same
    place-not-shape refusals as the self-service put. Scope is the same `_load`
    wall as the profile itself: 404 out of territory, 403 for a staff user
    reaching into a franchisee whose people they do not manage — the franchisee
    admin uses its own `/franchise/technicians/{id}/base-location` twin.
    """
    return envelope(
        await service.set_base_location(db, principal, technician_id, body),
        message="Base location saved",
    )


@router.delete(
    "/{technician_id}",
    response_model=ApiEnvelope[None],
    dependencies=[Depends(require_min_rank(AREA_MANAGER))],
)
async def delete_technician(
    technician_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[None]:
    """Removing a technician carries `technicians.edit` AND an Area-Manager
    floor, same reasoning as the UPI-change decisions below: a Feature Access
    override must not be able to hand this below the managers the business
    named. 409 `TECHNICIAN_HAS_OPEN_JOBS` while a job is still open."""
    await service.delete_technician(db, principal, technician_id)
    return envelope(None, message="Technician removed")


# ── a technician's UPI change, decided by a manager ───────────────────────────
#
# Territory-scoped through the same `_load` as the profile, so a technician
# outside your area is a 404. Deciding carries `technicians.edit` AND an
# Area-Manager floor: it changes where somebody's money lands, and a Feature
# Access override must not be able to hand that below the managers the business
# named. Whoever's bell rang, any manager who can edit this technician may act.


@router.get(
    "/{technician_id}/upi-change", response_model=ApiEnvelope[UpiChangeOut | None]
)
async def get_upi_change(
    technician_id: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[UpiChangeOut | None]:
    """The change waiting on this technician, or null."""
    return envelope(await service.get_upi_change(db, principal, technician_id))


@router.post(
    "/{technician_id}/upi-change/approve",
    response_model=ApiEnvelope[UpiChangeOut],
    dependencies=[Depends(require_min_rank(AREA_MANAGER))],
)
async def approve_upi_change(
    technician_id: uuid.UUID, db: Db, principal: CanEdit
) -> ApiEnvelope[UpiChangeOut]:
    """Apply the new UPI ID and name. No code — the manager is the check."""
    return envelope(
        await service.approve_upi_change(db, principal, technician_id),
        message="UPI ID changed",
    )


@router.post(
    "/{technician_id}/upi-change/reject",
    response_model=ApiEnvelope[UpiChangeOut],
    dependencies=[Depends(require_min_rank(AREA_MANAGER))],
)
async def reject_upi_change(
    technician_id: uuid.UUID, body: UpiRejectRequest, db: Db, principal: CanEdit
) -> ApiEnvelope[UpiChangeOut]:
    """Refuse it, with a reason the technician reads. Their UPI ID stays."""
    return envelope(
        await service.reject_upi_change(db, principal, technician_id, body),
        message="Change rejected",
    )
