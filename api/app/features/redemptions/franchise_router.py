"""The franchisee's payout queue — the `/franchise` twins.

Task 05 §4.7: a redemption of a NON-home technician is that franchisee's own
admin to pay (R3) — the company payer reads it and may not act on it, which
is why these routes exist. They reuse the staff service functions verbatim;
`_payer_scope` / `_load_for_staff` pin every row to the principal's
franchisee, because `require_franchise_principal` has already pinned the
caller and the wall is structural.

⚠ No `require_min_rank` (§8 trap 4 — a franchisee admin ranks below every
staff role), and there is deliberately NO confirm route: only the technician
confirms, here as on the staff door. `/count` is declared before
`/{redemption_id}` or FastAPI would parse "count" as a UUID and answer 422.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_franchise_principal
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    canonical_filter,
    envelope,
    list_params,
    paginated,
)
from app.features.redemptions import service
from app.features.redemptions.schemas import (
    REDEMPTION_STATES,
    ClaimRequest,
    DeclineRequest,
    RedemptionCountOut,
    StaffRedemptionDetailOut,
    StaffRedemptionOut,
)

router = APIRouter(prefix="/franchise", tags=["franchise"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: `franchise.payouts` — where their technicians' money lands. Role test and
#: feature key both, like every `/franchise` door (Task 02's guard + Task 02's
#: seeded key): the role pins WHO, the feature says whether the company
#: opened it.
CanPay = Annotated[
    Principal,
    Depends(require_franchise_principal),
    Depends(require_feature("franchise.payouts")),
]


@router.get(
    "/redemptions", response_model=PaginatedEnvelope[StaffRedemptionOut]
)
async def list_redemptions(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanPay,
    state: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[StaffRedemptionOut]:
    """This franchisee's queue, in the staff list's own shape.

    `state` is the same four words; an unknown one is an empty page, never a
    422 (`canonical_filter`).
    """
    wanted = canonical_filter(state, REDEMPTION_STATES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.list_page(db, principal, params, state=wanted)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/redemptions/count", response_model=ApiEnvelope[RedemptionCountOut])
async def count_redemptions(db: Db, principal: CanPay) -> ApiEnvelope[RedemptionCountOut]:
    """How many of ours nobody has paid yet — this tab's badge."""
    return envelope(
        RedemptionCountOut(toPay=await service.count_to_pay(db, principal))
    )


@router.get(
    "/redemptions/{redemption_id}",
    response_model=ApiEnvelope[StaffRedemptionDetailOut],
)
async def get_redemption(
    db: Db, principal: CanPay, redemption_id: uuid.UUID
) -> ApiEnvelope[StaffRedemptionDetailOut]:
    """One of ours. Another franchisee's — 404, never 403."""
    return envelope(await service.staff_detail(db, principal, redemption_id))


@router.post(
    "/redemptions/{redemption_id}/claim",
    response_model=ApiEnvelope[StaffRedemptionDetailOut],
)
async def claim_redemption(
    db: Db,
    principal: CanPay,
    redemption_id: uuid.UUID,
    body: ClaimRequest,
) -> ApiEnvelope[StaffRedemptionDetailOut]:
    """We paid them — the screenshot says so. The technician is pushed to confirm.

    Their confirmation, still and only, is what settles it; this door has no
    route that says so for them.
    """
    return envelope(
        await service.claim(db, principal, redemption_id, body),
        message="Marked as paid",
    )


@router.post(
    "/redemptions/{redemption_id}/decline",
    response_model=ApiEnvelope[StaffRedemptionDetailOut],
)
async def decline_redemption(
    db: Db,
    principal: CanPay,
    redemption_id: uuid.UUID,
    body: DeclineRequest,
) -> ApiEnvelope[StaffRedemptionDetailOut]:
    """Refuse it before paying. 409 once anybody has claimed it."""
    return envelope(
        await service.decline(db, principal, redemption_id, body),
        message="Redemption declined",
    )