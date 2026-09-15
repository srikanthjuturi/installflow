"""The platform's side of credits — the superadmin's Rules and recharge queue.

Superadmin only, and nothing else can reach it: `require_superadmin` is the one
guard a principal with no company passes. Reads here cross every company, which
is what the superadmin is for; writes touch one recharge, or the one settings
row.

`/recharges/count` and `/recharges/waiting` are declared before
`/recharges/{recharge_id}`, or FastAPI would parse the word as a UUID and 422.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_superadmin
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    canonical_filter,
    envelope,
    list_params,
    paginated,
)
from app.features.credits import service
from app.features.credits.schemas import (
    RECHARGE_STATES,
    PlatformRechargeDetailOut,
    PlatformRechargeOut,
    PlatformSettingsIn,
    PlatformSettingsOut,
    RechargeCountOut,
    RechargeRejectRequest,
)

router = APIRouter(prefix="/platform", tags=["platform"])

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]
Superadmin = Annotated[Principal, Depends(require_superadmin)]


@router.get("/settings", response_model=ApiEnvelope[PlatformSettingsOut])
async def get_settings(db: Db, _: Superadmin) -> ApiEnvelope[PlatformSettingsOut]:
    return envelope(await service.get_settings(db))


@router.put("/settings", response_model=ApiEnvelope[PlatformSettingsOut])
async def update_settings(
    db: Db, principal: Superadmin, body: PlatformSettingsIn
) -> ApiEnvelope[PlatformSettingsOut]:
    """Free credits, the ticket charge, the floor, the minimum recharge, the UPI ID."""
    return envelope(
        await service.update_settings(db, principal, body), message="Rules saved"
    )


@router.get("/recharges", response_model=PaginatedEnvelope[PlatformRechargeOut])
async def list_recharges(
    db: Db,
    _: Superadmin,
    params: Params,
    state: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[PlatformRechargeOut]:
    """Every company's recharges. An unknown `state` is an empty page."""
    wanted = canonical_filter(state, RECHARGE_STATES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.platform_page(db, params, state=wanted)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/recharges/count", response_model=ApiEnvelope[RechargeCountOut])
async def count_waiting(db: Db, _: Superadmin) -> ApiEnvelope[RechargeCountOut]:
    """Claims nobody has decided — the rail badge and the bell's number."""
    return envelope(RechargeCountOut(waiting=await service.platform_count(db)))


@router.get(
    "/recharges/waiting", response_model=ApiEnvelope[list[PlatformRechargeOut]]
)
async def list_waiting(db: Db, _: Superadmin) -> ApiEnvelope[list[PlatformRechargeOut]]:
    """The bell's dropdown: the latest claims waiting for a decision."""
    return envelope(await service.platform_waiting(db))


@router.get(
    "/recharges/{recharge_id}", response_model=ApiEnvelope[PlatformRechargeDetailOut]
)
async def get_recharge(
    db: Db, _: Superadmin, recharge_id: uuid.UUID
) -> ApiEnvelope[PlatformRechargeDetailOut]:
    return envelope(await service.platform_detail(db, recharge_id))


@router.post(
    "/recharges/{recharge_id}/confirm",
    response_model=ApiEnvelope[PlatformRechargeDetailOut],
)
async def confirm_recharge(
    db: Db, principal: Superadmin, recharge_id: uuid.UUID
) -> ApiEnvelope[PlatformRechargeDetailOut]:
    """The payment arrived — add the credits. The only way credits are ever bought."""
    return envelope(
        await service.confirm(db, principal, recharge_id), message="Credits added"
    )


@router.post(
    "/recharges/{recharge_id}/reject",
    response_model=ApiEnvelope[PlatformRechargeDetailOut],
)
async def reject_recharge(
    db: Db, principal: Superadmin, recharge_id: uuid.UUID, body: RechargeRejectRequest
) -> ApiEnvelope[PlatformRechargeDetailOut]:
    """It did not arrive, or does not match. The company reads the reason."""
    return envelope(
        await service.reject(db, principal, recharge_id, body),
        message="Recharge rejected",
    )
