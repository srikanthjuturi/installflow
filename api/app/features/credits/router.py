"""Credits — a company's balance, statement and recharges.

**Admin and National Head only**, and both guards, for the reason
`redemptions/router.py` gives: `credits.manage` is what the console reads to
draw the rail entry and is seeded to exactly those two roles, and the National
Head rank floor is what survives somebody handing the key to a Regional Head on
Feature Access. This spends company money.

**There is no route here that adds credits.** A company claims it paid; only
the superadmin confirms (`platform_router.py`).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_min_rank
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
    ENTRY_KINDS,
    RECHARGE_STATES,
    CreditEntryOut,
    CreditSummaryOut,
    RechargeClaimRequest,
    RechargeDetailOut,
    RechargeOut,
    RechargeRequest,
)
from app.models.role import NATIONAL_HEAD

router = APIRouter(prefix="/credits", tags=["credits"])

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]
CanManage = Annotated[Principal, Depends(require_feature("credits.manage"))]
HeadRoute = [Depends(require_min_rank(NATIONAL_HEAD))]


@router.get("", response_model=ApiEnvelope[CreditSummaryOut], dependencies=HeadRoute)
async def get_credits(db: Db, principal: CanManage) -> ApiEnvelope[CreditSummaryOut]:
    """The balance, the rules it is spent under, and whatever recharge is open."""
    return envelope(await service.summary(db, principal))


@router.get(
    "/entries",
    response_model=PaginatedEnvelope[CreditEntryOut],
    dependencies=HeadRoute,
)
async def list_entries(
    db: Db,
    principal: CanManage,
    params: Params,
    kind: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[CreditEntryOut]:
    """The statement. `kind` is `free`, `ticket` or `recharge`; unknown is empty."""
    wanted = canonical_filter(kind, ENTRY_KINDS)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.entries_page(db, principal, params, kind=wanted)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/recharges",
    response_model=PaginatedEnvelope[RechargeOut],
    dependencies=HeadRoute,
)
async def list_recharges(
    db: Db,
    principal: CanManage,
    params: Params,
    state: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[RechargeOut]:
    wanted = canonical_filter(state, RECHARGE_STATES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.recharges_page(db, principal, params, state=wanted)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/recharges",
    response_model=ApiEnvelope[RechargeDetailOut],
    status_code=201,
    dependencies=HeadRoute,
)
async def create_recharge(
    db: Db, principal: CanManage, body: RechargeRequest
) -> ApiEnvelope[RechargeDetailOut]:
    """Start a recharge and get its QR.

    422 `BAD_AMOUNT` outside the rules' bounds; 409 `RECHARGE_UNAVAILABLE` until
    the platform has a UPI ID, and `RECHARGE_OPEN` while another is open.
    """
    return envelope(
        await service.create_recharge(db, principal, body),
        message="Recharge started",
        status_code=201,
    )


@router.get(
    "/recharges/{recharge_id}",
    response_model=ApiEnvelope[RechargeDetailOut],
    dependencies=HeadRoute,
)
async def get_recharge(
    db: Db, principal: CanManage, recharge_id: uuid.UUID
) -> ApiEnvelope[RechargeDetailOut]:
    return envelope(await service.recharge_detail(db, principal, recharge_id))


@router.post(
    "/recharges/{recharge_id}/claim",
    response_model=ApiEnvelope[RechargeDetailOut],
    dependencies=HeadRoute,
)
async def claim_recharge(
    db: Db, principal: CanManage, recharge_id: uuid.UUID, body: RechargeClaimRequest
) -> ApiEnvelope[RechargeDetailOut]:
    """The company says it paid — UTR and screenshot. The superadmin decides."""
    return envelope(
        await service.claim_recharge(db, principal, recharge_id, body),
        message="Payment submitted",
    )


@router.post(
    "/recharges/{recharge_id}/cancel",
    response_model=ApiEnvelope[RechargeDetailOut],
    dependencies=HeadRoute,
)
async def cancel_recharge(
    db: Db, principal: CanManage, recharge_id: uuid.UUID
) -> ApiEnvelope[RechargeDetailOut]:
    """Withdraw it before paying. 409 once the payment has been submitted."""
    return envelope(
        await service.cancel_recharge(db, principal, recharge_id),
        message="Recharge cancelled",
    )
