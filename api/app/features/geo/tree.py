"""The coverage picker's tree: Region -> State -> District -> Pincode (Epic 2).

Three reads, built so a browser never has to hold 19,496 pincodes:

  * `build_tree` -- one region's states and districts with counts, and (given the
    codes already selected) how many of each are selected, so a saved coverage
    opens with the right boxes ticked and the right ones half-ticked;
  * `district_pincodes` -- the leaf level, fetched only when a district opens;
  * `expand` -- "tick the whole state / district" without paging through it.

## What a caller may see

The same set the existing pickers allow, never wider:

  * only ACTIVE pincodes (ticket intake refuses a switched-off one);
  * inside the caller's territory -- an Area Manager's states, a Regional Head's
    regions; all-India roles see everything;
  * and, when the coverage is for a franchisee, inside that franchisee's
    pincodes (`core.franchise.franchisee_pincodes_subquery`) -- a franchisee
    admin is always pinned to its own; staff may name one.

The server still validates the codes on save (`PINCODE_OUTSIDE_FRANCHISEE`, the
Area Manager state check). This only decides what the picker OFFERS, so the two
cannot be argued into disagreeing: both read the same scope.

## Counts through `pincode_districts`

A pincode can sit in up to four districts (1,209 of them), so district counts do
not sum to the state's. The state's own count is the honest total, and four
pincodes belong to no district at all -- they count for their state and are
reachable only by ticking the state.
"""

import uuid

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.franchise import franchisee_pincodes_subquery
from app.core.schemas import AppModel
from app.core.scope import ALL_INDIA_ROLES, own_scope
from app.models.franchisee import Franchisee
from app.models.territory import District, Pincode, PincodeDistrict, State

#: The most one `expand` may return, and the most `selected` a tree may be sent.
#: Beyond it the answer is "narrow it", not a slow response.
MAX_CODES = 5000


class TreeRequest(BaseModel):
    regionId: uuid.UUID
    #: Pincodes already chosen, so the tree can count them per node.
    selected: list[str] = Field(default_factory=list, max_length=MAX_CODES)
    franchiseeId: uuid.UUID | None = None


class ExpandRequest(BaseModel):
    stateIds: list[uuid.UUID] = Field(default_factory=list, max_length=60)
    districtIds: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    franchiseeId: uuid.UUID | None = None


class DistrictNode(AppModel):
    id: uuid.UUID
    name: str
    pincodeCount: int
    selectedCount: int


class StateNode(AppModel):
    id: uuid.UUID
    name: str
    pincodeCount: int
    selectedCount: int
    districts: list[DistrictNode]


class TreeOut(AppModel):
    regionId: uuid.UUID
    states: list[StateNode]


class DistrictPincodesOut(AppModel):
    districtId: uuid.UUID
    pincodes: list[str]


class ExpandOut(AppModel):
    pincodes: list[str]
    count: int


async def _allowed(
    db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID | None
) -> list:
    """WHERE clauses over `Pincode` for what this caller may be offered."""
    conds: list = [Pincode.is_active.is_(True)]

    if principal.role not in ALL_INDIA_ROLES and not principal.is_franchise:
        _own_id, own = await own_scope(
            db, user_id=principal.user_id, company_id=principal.company_id
        )
        if own.state_ids:
            conds.append(Pincode.state_id.in_(list(own.state_ids)))
        elif own.region_ids:
            conds.append(
                Pincode.state_id.in_(
                    select(State.id).where(State.region_id.in_(list(own.region_ids)))
                )
            )
        else:
            conds.append(Pincode.code.is_(None))  # a scoped role with nothing assigned

    if principal.is_franchise:
        franchisee_id = principal.franchisee_id
    if franchisee_id is not None:
        if principal.company_id is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Select a company first")
        franchisee = await db.scalar(
            select(Franchisee).where(
                Franchisee.id == franchisee_id,
                Franchisee.company_id == principal.company_id,
                Franchisee.deleted_at.is_(None),
            )
        )
        if franchisee is None:
            # 404, never 403: another company's franchisee does not exist here.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Franchisee not found")
        conds.append(
            Pincode.code.in_(
                franchisee_pincodes_subquery(
                    principal.company_id, franchisee.id, is_home=franchisee.is_home
                )
            )
        )
    return conds


async def build_tree(
    db: AsyncSession, principal: Principal, body: TreeRequest
) -> TreeOut:
    allowed = await _allowed(db, principal, body.franchiseeId)
    selected = {c for c in body.selected if len(c) == 6}

    states = (
        await db.execute(
            select(State.id, State.name)
            .where(State.region_id == body.regionId)
            .order_by(State.name)
        )
    ).all()
    if not states:
        return TreeOut(regionId=body.regionId, states=[])
    state_ids = [s.id for s in states]

    state_total = dict(
        (
            await db.execute(
                select(Pincode.state_id, func.count())
                .where(Pincode.state_id.in_(state_ids), *allowed)
                .group_by(Pincode.state_id)
            )
        ).all()
    )
    state_selected: dict[uuid.UUID, int] = {}
    if selected:
        state_selected = dict(
            (
                await db.execute(
                    select(Pincode.state_id, func.count())
                    .where(
                        Pincode.state_id.in_(state_ids),
                        Pincode.code.in_(selected),
                        *allowed,
                    )
                    .group_by(Pincode.state_id)
                )
            ).all()
        )

    districts = (
        await db.execute(
            select(District.id, District.name, District.state_id)
            .where(District.state_id.in_(state_ids))
            .order_by(District.name)
        )
    ).all()
    district_total = dict(
        (
            await db.execute(
                select(PincodeDistrict.district_id, func.count(PincodeDistrict.pincode_code.distinct()))
                .join(Pincode, Pincode.code == PincodeDistrict.pincode_code)
                .where(Pincode.state_id.in_(state_ids), *allowed)
                .group_by(PincodeDistrict.district_id)
            )
        ).all()
    )
    district_selected: dict[uuid.UUID, int] = {}
    if selected:
        district_selected = dict(
            (
                await db.execute(
                    select(
                        PincodeDistrict.district_id,
                        func.count(PincodeDistrict.pincode_code.distinct()),
                    )
                    .join(Pincode, Pincode.code == PincodeDistrict.pincode_code)
                    .where(
                        Pincode.state_id.in_(state_ids),
                        Pincode.code.in_(selected),
                        *allowed,
                    )
                    .group_by(PincodeDistrict.district_id)
                )
            ).all()
        )

    by_state: dict[uuid.UUID, list[DistrictNode]] = {s: [] for s in state_ids}
    for d in districts:
        total = int(district_total.get(d.id, 0))
        if total == 0:
            continue  # nothing this caller could pick -- do not offer an empty branch
        by_state[d.state_id].append(
            DistrictNode(
                id=d.id,
                name=d.name,
                pincodeCount=total,
                selectedCount=int(district_selected.get(d.id, 0)),
            )
        )
    nodes = [
        StateNode(
            id=s.id,
            name=s.name,
            pincodeCount=int(state_total.get(s.id, 0)),
            selectedCount=int(state_selected.get(s.id, 0)),
            districts=by_state[s.id],
        )
        for s in states
        if int(state_total.get(s.id, 0)) > 0
    ]
    return TreeOut(regionId=body.regionId, states=nodes)


async def district_pincodes(
    db: AsyncSession,
    principal: Principal,
    district_id: uuid.UUID,
    franchisee_id: uuid.UUID | None,
) -> DistrictPincodesOut:
    allowed = await _allowed(db, principal, franchisee_id)
    codes = (
        await db.scalars(
            select(Pincode.code)
            .join(PincodeDistrict, PincodeDistrict.pincode_code == Pincode.code)
            .where(PincodeDistrict.district_id == district_id, *allowed)
            .order_by(Pincode.code)
        )
    ).all()
    return DistrictPincodesOut(districtId=district_id, pincodes=list(codes))


async def expand(
    db: AsyncSession, principal: Principal, body: ExpandRequest
) -> ExpandOut:
    if not body.stateIds and not body.districtIds:
        return ExpandOut(pincodes=[], count=0)
    allowed = await _allowed(db, principal, body.franchiseeId)
    codes: set[str] = set()
    if body.stateIds:
        codes.update(
            await db.scalars(
                select(Pincode.code).where(Pincode.state_id.in_(body.stateIds), *allowed)
            )
        )
    if body.districtIds:
        codes.update(
            await db.scalars(
                select(Pincode.code)
                .join(PincodeDistrict, PincodeDistrict.pincode_code == Pincode.code)
                .where(PincodeDistrict.district_id.in_(body.districtIds), *allowed)
            )
        )
    if len(codes) > MAX_CODES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"That is {len(codes):,} pincodes - choose a smaller area (up to {MAX_CODES:,}).",
        )
    ordered = sorted(codes)
    return ExpandOut(pincodes=ordered, count=len(ordered))
