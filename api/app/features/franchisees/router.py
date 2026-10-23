"""Franchisee endpoints (03 §4.3).

Routes 1–3 and 9 (read) open at `franchisees.view` and an Area Manager floor —
an AM may ring SkyFix's admin even though only a National Head may change it.
Everything that writes (`franchisees.manage`) floors at National Head, above
every staff rank that can already read. Franchise/vendor/technician principals
never reach here: `require_staff_principal` refuses them before the floor does.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
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
from app.core.travel_rules import TravelRulesOut
from app.models.role import AREA_MANAGER, NATIONAL_HEAD

from app.features.franchisees import service
from app.features.franchisees.schemas import (
    FranchiseeAdminCreatedOut,
    FranchiseeAdminIn,
    FranchiseeAdminOut,
    FranchiseeCreateRequest,
    FranchiseeCreatedOut,
    FranchiseeOut,
    FranchiseeOptionOut,
    FranchiseeUpdateRequest,
    PincodeChangeOut,
    PincodesRequest,
)

router = APIRouter(prefix="/franchisees", tags=["franchisees"])

Db = Annotated[AsyncSession, Depends(get_db)]

CanView = Annotated[
    Principal,
    Depends(require_feature("franchisees.view")),
    Depends(require_staff_principal),
    Depends(require_min_rank(AREA_MANAGER)),
]
CanManage = Annotated[
    Principal,
    Depends(require_feature("franchisees.manage")),
    Depends(require_staff_principal),
    Depends(require_min_rank(NATIONAL_HEAD)),
]

#: Duplicated from `data.emailStatus` for the same reason as `users/router`:
#: the console reads `data` and drops `message`, so these strings serve API
#: consumers, Swagger and the logs — and both must keep saying the same thing.
_CREATED_MESSAGE = {
    "sent": "Franchisee admin added — the temporary password has been emailed",
    "skipped": "Franchisee admin added — they sign in with the password they already use",
    "failed": "Franchisee admin added, but the password email did not go out",
}

_REISSUED_MESSAGE = {
    "sent": "A new temporary password has been emailed",
    "skipped": "Password reset",
    "failed": "Password reset, but the email did not go out",
}


@router.get("", response_model=PaginatedEnvelope[FranchiseeOut])
async def list_franchisees(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanView,
    kind: Annotated[str | None, Query()] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> PaginatedEnvelope[FranchiseeOut]:
    rows, total = await service.list_franchisees(
        db, principal, params, kind=kind, status_filter=status_filter
    )
    return paginated(
        rows, page=params.page, limit=params.limit, total=total
    )


# Declared BEFORE /{franchiseeId} so FastAPI matches "options" as this route,
# not as a franchisee id.
@router.get("/options", response_model=ApiEnvelope[list[FranchiseeOptionOut]])
async def list_options(
    db: Db,
    principal: CanView,
) -> ApiEnvelope[list[FranchiseeOptionOut]]:
    return envelope(await service.list_options(db, principal))


@router.post("", response_model=ApiEnvelope[FranchiseeCreatedOut], status_code=201)
async def create_franchisee(
    body: FranchiseeCreateRequest,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeCreatedOut]:
    """Create a franchisee — no pincodes (Task 08's adoption): pincodes always
    go through the dry-run-able `PUT …/pincodes` path. Optionally mints the
    first admin login; the temporary password is emailed AFTER commit and
    reported in `admin.emailStatus`.
    """
    data = await service.create_franchisee(db, principal, body)
    return envelope(data, message="Franchisee created", status_code=201)


@router.get("/{franchiseeId}", response_model=ApiEnvelope[FranchiseeOut])
async def get_franchisee(
    franchiseeId: uuid.UUID,
    db: Db,
    principal: CanView,
) -> ApiEnvelope[FranchiseeOut]:
    return envelope(await service.get_franchisee(db, principal, franchiseeId))


@router.get(
    "/{franchiseeId}/travel-rules", response_model=ApiEnvelope[TravelRulesOut]
)
async def get_travel_rules(
    franchiseeId: uuid.UUID, db: Db, principal: CanView
) -> ApiEnvelope[TravelRulesOut]:
    """One franchisee's allowance rules, read-only — Task 13's per-franchisee
    view. The edit lives in the settings slice either side of this router;
    here a manager simply reads what a franchisee is being paid by (10 §4.8).
    Same `_load` wall as the profile above: another company's id is a 404.
    """
    return envelope(await service.get_travel_rules(db, principal, franchiseeId))


@router.put("/{franchiseeId}", response_model=ApiEnvelope[FranchiseeOut])
async def update_franchisee(
    franchiseeId: uuid.UUID,
    body: FranchiseeUpdateRequest,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeOut]:
    data = await service.update_franchisee(db, principal, franchiseeId, body)
    return envelope(data, message="Franchisee updated")


@router.put(
    "/{franchiseeId}/pincodes", response_model=ApiEnvelope[PincodeChangeOut]
)
async def set_pincodes(
    franchiseeId: uuid.UUID,
    body: PincodesRequest,
    db: Db,
    principal: CanManage,
    dryRun: Annotated[bool, Query()] = False,
) -> ApiEnvelope[PincodeChangeOut]:
    """Preview (dryRun=true, 200 — nothing locked, nothing written) or apply
    the carve-out. Apply names every claimed code in a 409; preview lists them
    and plans the rest.
    """
    data = await service.set_pincodes(
        db, principal, franchiseeId, body, dry_run=dryRun
    )
    message = "Preview — nothing was saved" if data.dryRun else "Pincodes saved"
    return envelope(data, message=message)


@router.post("/{franchiseeId}/deactivate", response_model=ApiEnvelope[FranchiseeOut])
async def deactivate_franchisee(
    franchiseeId: uuid.UUID,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeOut]:
    data = await service.deactivate(db, principal, franchiseeId)
    return envelope(data, message="Franchisee deactivated")


@router.post("/{franchiseeId}/activate", response_model=ApiEnvelope[FranchiseeOut])
async def activate_franchisee(
    franchiseeId: uuid.UUID,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeOut]:
    data = await service.activate(db, principal, franchiseeId)
    return envelope(data, message="Franchisee activated")


@router.get(
    "/{franchiseeId}/admins", response_model=ApiEnvelope[list[FranchiseeAdminOut]]
)
async def list_admins(
    franchiseeId: uuid.UUID,
    db: Db,
    principal: CanView,
) -> ApiEnvelope[list[FranchiseeAdminOut]]:
    """Read at VIEW (an AM may need to ring the admin), even though every
    write below is MANAGE — this screen's one asymmetry (03 §4.3)."""
    return envelope(await service.list_admins(db, principal, franchiseeId))


@router.post(
    "/{franchiseeId}/admins",
    response_model=ApiEnvelope[FranchiseeAdminCreatedOut],
    status_code=201,
)
async def add_admin(
    franchiseeId: uuid.UUID,
    body: FranchiseeAdminIn,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeAdminCreatedOut]:
    """Mint an admin login for this franchisee; the password is emailed after
    commit. `isLastActiveAdmin` in the response tells the console whether this
    row would now be the one that cannot be deactivated."""
    data = await service.add_admin(db, principal, franchiseeId, body)
    return envelope(
        data, message=_CREATED_MESSAGE[data.emailStatus], status_code=201
    )


@router.post(
    "/{franchiseeId}/admins/{membershipId}/deactivate",
    response_model=ApiEnvelope[FranchiseeAdminOut],
)
async def deactivate_admin(
    franchiseeId: uuid.UUID,
    membershipId: uuid.UUID,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeAdminOut]:
    """R3: refusing to deactivate the last active admin of a non-home
    franchisee (409 FRANCHISEE_LAST_ADMIN); the home is exempt (F8)."""
    data = await service.set_admin_active(
        db, principal, franchiseeId, membershipId, active=False
    )
    return envelope(data, message="Admin deactivated")


@router.post(
    "/{franchiseeId}/admins/{membershipId}/activate",
    response_model=ApiEnvelope[FranchiseeAdminOut],
)
async def activate_admin(
    franchiseeId: uuid.UUID,
    membershipId: uuid.UUID,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeAdminOut]:
    data = await service.set_admin_active(
        db, principal, franchiseeId, membershipId, active=True
    )
    return envelope(data, message="Admin activated")


@router.post(
    "/{franchiseeId}/admins/{membershipId}/reissue-password",
    response_model=ApiEnvelope[FranchiseeAdminCreatedOut],
)
async def reissue_admin_password(
    franchiseeId: uuid.UUID,
    membershipId: uuid.UUID,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FranchiseeAdminCreatedOut]:
    """Email this admin a fresh temporary password and end their sessions."""
    data = await service.reissue_admin_password(
        db, principal, franchiseeId, membershipId
    )
    return envelope(data, message=_REISSUED_MESSAGE[data.emailStatus])