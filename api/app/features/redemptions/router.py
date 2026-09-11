"""Redemptions — a technician's side under `/me`, the payer's side under `/{id}`.

**The technician** carries `pool.view` (hard rule 2 — the key every
technician-facing route uses) AND `TechnicianPrincipal`, which also resolves
the profile that is the whole scope of their queries. There is no path from
here to anybody else's money.

**The payer** carries `redemptions.pay` AND a National Head rank floor. The
feature is what the console reads to draw the rail entry; the floor is what
makes "National Head and above" survive somebody handing the feature to a
Regional Head on Feature Access. This spends company money, so it gets both
(hard rule 2 again, and the reasoning `jobs.force_close` set out).

**There is deliberately no route that marks a redemption paid.** The payer
claims, the technician confirms, and those are two different doors held by two
different people. Nothing — not a payer, not an admin — can do the other's.

`/me` routes are declared before `/{redemption_id}`, or FastAPI would try to
parse "me" as a UUID and answer 422.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    TechnicianPrincipal,
    require_feature,
    require_min_rank,
)
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
    ConfirmRequest,
    DeclineRequest,
    RedeemableOut,
    RedeemRequest,
    RedemptionCountOut,
    RedemptionDetailOut,
    RedemptionOut,
    StaffRedemptionDetailOut,
    StaffRedemptionOut,
)
from app.models.role import NATIONAL_HEAD

router = APIRouter(prefix="/redemptions", tags=["redemptions"])

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]

#: The technician's own — see the module docstring.
TechnicianRoute = [Depends(require_feature("pool.view"))]

CanPay = Annotated[Principal, Depends(require_feature("redemptions.pay"))]
PayerRoute = [Depends(require_min_rank(NATIONAL_HEAD))]


# ── the technician ───────────────────────────────────────────────────────────


@router.get(
    "/me", response_model=ApiEnvelope[RedeemableOut], dependencies=TechnicianRoute
)
async def get_my_balance(db: Db, me: TechnicianPrincipal) -> ApiEnvelope[RedeemableOut]:
    """What they may redeem now, where it would go, and whatever is open."""
    _, profile = me
    return envelope(await service.summary(db, profile))


@router.post(
    "/me",
    response_model=ApiEnvelope[RedemptionDetailOut],
    status_code=201,
    dependencies=TechnicianRoute,
)
async def request_redemption(
    db: Db, me: TechnicianPrincipal, body: RedeemRequest
) -> ApiEnvelope[RedemptionDetailOut]:
    """Ask to be paid the balance.

    409 with a `code` the app branches on: `REDEMPTION_OPEN`, `NO_UPI_ID`,
    `NOTHING_TO_REDEEM`, or `BALANCE_CHANGED` when the figure it showed is no
    longer the balance.
    """
    principal, profile = me
    return envelope(
        await service.request(db, principal, profile, body),
        message="Redemption requested",
        status_code=201,
    )


@router.get(
    "/me/history",
    response_model=PaginatedEnvelope[RedemptionOut],
    dependencies=TechnicianRoute,
)
async def list_my_redemptions(
    db: Db, me: TechnicianPrincipal, params: Params
) -> PaginatedEnvelope[RedemptionOut]:
    _, profile = me
    rows, total = await service.my_history(db, profile, params)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/me/{redemption_id}",
    response_model=ApiEnvelope[RedemptionDetailOut],
    dependencies=TechnicianRoute,
)
async def get_my_redemption(
    db: Db, me: TechnicianPrincipal, redemption_id: uuid.UUID
) -> ApiEnvelope[RedemptionDetailOut]:
    _, profile = me
    return envelope(await service.my_detail(db, profile, redemption_id))


@router.post(
    "/me/{redemption_id}/confirm",
    response_model=ApiEnvelope[RedemptionDetailOut],
    dependencies=TechnicianRoute,
)
async def confirm_redemption(
    db: Db, me: TechnicianPrincipal, redemption_id: uuid.UUID, body: ConfirmRequest
) -> ApiEnvelope[RedemptionDetailOut]:
    """The technician's word: it arrived (the only thing that settles one), or not yet."""
    principal, profile = me
    return envelope(
        await service.confirm(
            db, principal, profile, redemption_id, received=body.received
        )
    )


# ── the payer ────────────────────────────────────────────────────────────────


@router.get(
    "", response_model=PaginatedEnvelope[StaffRedemptionOut], dependencies=PayerRoute
)
async def list_redemptions(
    db: Db,
    principal: CanPay,
    params: Params,
    state: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[StaffRedemptionOut]:
    """The queue. `state` is `to_pay`, `awaiting`, `settled` or `declined`.

    An unknown state is an empty page rather than a 422 — a stale bookmark
    should show nothing, not break the screen (`canonical_filter`).
    """
    wanted = canonical_filter(state, REDEMPTION_STATES)
    if wanted is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.list_page(db, principal, params, state=wanted)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/count", response_model=ApiEnvelope[RedemptionCountOut], dependencies=PayerRoute
)
async def count_redemptions(
    db: Db, principal: CanPay
) -> ApiEnvelope[RedemptionCountOut]:
    """How many nobody has paid yet — the rail badge."""
    return envelope(RedemptionCountOut(toPay=await service.count_to_pay(db, principal)))


@router.get(
    "/{redemption_id}",
    response_model=ApiEnvelope[StaffRedemptionDetailOut],
    dependencies=PayerRoute,
)
async def get_redemption(
    db: Db, principal: CanPay, redemption_id: uuid.UUID
) -> ApiEnvelope[StaffRedemptionDetailOut]:
    return envelope(await service.staff_detail(db, principal, redemption_id))


@router.post(
    "/{redemption_id}/claim",
    response_model=ApiEnvelope[StaffRedemptionDetailOut],
    dependencies=PayerRoute,
)
async def claim_redemption(
    db: Db, principal: CanPay, redemption_id: uuid.UUID, body: ClaimRequest
) -> ApiEnvelope[StaffRedemptionDetailOut]:
    """The payer says they paid, with the screenshot. The technician is pushed to confirm."""
    return envelope(
        await service.claim(db, principal, redemption_id, body),
        message="Marked as paid",
    )


@router.post(
    "/{redemption_id}/decline",
    response_model=ApiEnvelope[StaffRedemptionDetailOut],
    dependencies=PayerRoute,
)
async def decline_redemption(
    db: Db, principal: CanPay, redemption_id: uuid.UUID, body: DeclineRequest
) -> ApiEnvelope[StaffRedemptionDetailOut]:
    """Refuse it before paying. 409 once anybody has claimed it."""
    return envelope(
        await service.decline(db, principal, redemption_id, body),
        message="Redemption declined",
    )
