"""Company <-> franchisee transfers - both doors (Epic 1.2).

  /franchise-settlements    the company's Admin / National Head
                            (`finance.settlements` + a National Head rank floor,
                            both, for the reason `vendor_credits` gives: the key
                            draws the rail entry, the floor survives a Feature
                            Access toggle)
  /franchise/settlements    the franchisee's own admin (`franchise.settlements`
                            + the franchise-principal role test; never a rank
                            floor - a franchisee admin ranks below every staff
                            role)

Literal segments (`/count`, `/summary`, `/franchisees`) are declared BEFORE
`/{settlement_id}` or FastAPI parses them as a UUID and answers 422.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    require_all,
    require_feature,
    require_franchise_principal,
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
from app.features.franchise_settlements import service
from app.features.franchise_settlements.schemas import (
    DIRECTIONS,
    SETTLEMENT_STATES,
    DeclineSettlementRequest,
    FranchiseeOptionOut,
    RecordSettlementRequest,
    SettlementCountOut,
    SettlementOut,
    SettlementSummaryOut,
)
from app.models.role import NATIONAL_HEAD

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]

staff_router = APIRouter(prefix="/franchise-settlements", tags=["franchise-settlements"])
portal_router = APIRouter(prefix="/franchise/settlements", tags=["franchise"])

StaffP = Annotated[
    Principal,
    Depends(require_all(require_feature("finance.settlements"), require_min_rank(NATIONAL_HEAD))),
]
PortalP = Annotated[
    Principal,
    Depends(require_all(require_franchise_principal, require_feature("franchise.settlements"))),
]


async def _list(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    state: str | None,
    direction: str | None,
    franchisee_id: uuid.UUID | None,
) -> PaginatedEnvelope[SettlementOut]:
    # An unknown filter value is an empty page, never a 422 (`canonical_filter`).
    wanted_state = canonical_filter(state, SETTLEMENT_STATES)
    wanted_direction = canonical_filter(direction, DIRECTIONS)
    if wanted_state is False or wanted_direction is False:
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.list_page(
        db,
        principal,
        params,
        state=wanted_state,
        direction=wanted_direction,
        franchisee_id=franchisee_id,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


# ── the company's door ───────────────────────────────────────────────────────


@staff_router.get("/count", response_model=ApiEnvelope[SettlementCountOut])
async def staff_count(db: Db, principal: StaffP) -> ApiEnvelope[SettlementCountOut]:
    return envelope(await service.counts(db, principal))


@staff_router.get("/summary", response_model=ApiEnvelope[SettlementSummaryOut])
async def staff_summary(
    db: Db, principal: StaffP, franchiseeId: Annotated[uuid.UUID | None, Query()] = None
) -> ApiEnvelope[SettlementSummaryOut]:
    return envelope(await service.summary(db, principal, franchiseeId))


@staff_router.get("/franchisees", response_model=ApiEnvelope[list[FranchiseeOptionOut]])
async def staff_franchisees(db: Db, principal: StaffP) -> ApiEnvelope[list[FranchiseeOptionOut]]:
    return envelope(await service.franchisee_options(db, principal))


@staff_router.get("", response_model=PaginatedEnvelope[SettlementOut])
async def staff_list(
    db: Db,
    params: Params,
    principal: StaffP,
    state: Annotated[str | None, Query()] = None,
    direction: Annotated[str | None, Query()] = None,
    franchiseeId: Annotated[uuid.UUID | None, Query()] = None,
) -> PaginatedEnvelope[SettlementOut]:
    return await _list(db, principal, params, state, direction, franchiseeId)


@staff_router.post("", response_model=ApiEnvelope[SettlementOut], status_code=201)
async def staff_record(
    body: RecordSettlementRequest, db: Db, principal: StaffP
) -> ApiEnvelope[SettlementOut]:
    """The company recording money it SENT to a franchisee."""
    return envelope(await service.record(db, principal, body), status_code=201)


@staff_router.get("/{settlement_id}", response_model=ApiEnvelope[SettlementOut])
async def staff_detail(
    settlement_id: uuid.UUID, db: Db, principal: StaffP
) -> ApiEnvelope[SettlementOut]:
    return envelope(await service.detail(db, principal, settlement_id))


@staff_router.post("/{settlement_id}/confirm", response_model=ApiEnvelope[SettlementOut])
async def staff_confirm(
    settlement_id: uuid.UUID, db: Db, principal: StaffP
) -> ApiEnvelope[SettlementOut]:
    """The company saying money a franchisee sent has ARRIVED."""
    return envelope(await service.confirm(db, principal, settlement_id))


@staff_router.post("/{settlement_id}/decline", response_model=ApiEnvelope[SettlementOut])
async def staff_decline(
    settlement_id: uuid.UUID, body: DeclineSettlementRequest, db: Db, principal: StaffP
) -> ApiEnvelope[SettlementOut]:
    return envelope(await service.decline(db, principal, settlement_id, body.reason))


# ── the franchisee's door ────────────────────────────────────────────────────


@portal_router.get("/count", response_model=ApiEnvelope[SettlementCountOut])
async def portal_count(db: Db, principal: PortalP) -> ApiEnvelope[SettlementCountOut]:
    return envelope(await service.counts(db, principal))


@portal_router.get("/summary", response_model=ApiEnvelope[SettlementSummaryOut])
async def portal_summary(db: Db, principal: PortalP) -> ApiEnvelope[SettlementSummaryOut]:
    return envelope(await service.summary(db, principal, None))


@portal_router.get("", response_model=PaginatedEnvelope[SettlementOut])
async def portal_list(
    db: Db,
    params: Params,
    principal: PortalP,
    state: Annotated[str | None, Query()] = None,
    direction: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[SettlementOut]:
    return await _list(db, principal, params, state, direction, None)


@portal_router.post("", response_model=ApiEnvelope[SettlementOut], status_code=201)
async def portal_record(
    body: RecordSettlementRequest, db: Db, principal: PortalP
) -> ApiEnvelope[SettlementOut]:
    """The franchisee recording money it SENT to the company."""
    return envelope(await service.record(db, principal, body), status_code=201)


@portal_router.get("/{settlement_id}", response_model=ApiEnvelope[SettlementOut])
async def portal_detail(
    settlement_id: uuid.UUID, db: Db, principal: PortalP
) -> ApiEnvelope[SettlementOut]:
    return envelope(await service.detail(db, principal, settlement_id))


@portal_router.post("/{settlement_id}/confirm", response_model=ApiEnvelope[SettlementOut])
async def portal_confirm(
    settlement_id: uuid.UUID, db: Db, principal: PortalP
) -> ApiEnvelope[SettlementOut]:
    """The franchisee saying money the company sent has ARRIVED."""
    return envelope(await service.confirm(db, principal, settlement_id))


@portal_router.post("/{settlement_id}/decline", response_model=ApiEnvelope[SettlementOut])
async def portal_decline(
    settlement_id: uuid.UUID, body: DeclineSettlementRequest, db: Db, principal: PortalP
) -> ApiEnvelope[SettlementOut]:
    return envelope(await service.decline(db, principal, settlement_id, body.reason))
