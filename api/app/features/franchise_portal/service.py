"""Reading the master data a franchisee's portal pickers are filled from.

The two questions the Add-technician screen opens with, narrowed to what THIS
franchisee serves:

  * regions — the ones that hold at least one of its pincodes;
  * subcategories — every main sub-category of the company's tree, because
    certification is about SKILL, not geography, and the franchisee can hire
    anybody into any of them.

Both are the same facts the staff screens pick from, scoped by
`franchisee_pincodes_subquery` — a SUBQUERY, not a materialised list, because
a home pool is thousands of live codes (the `core.scope.pincodes_in_states`
rule again).
"""

import uuid

from collections import defaultdict
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.franchise import franchisee_pincodes_subquery
from app.core.product_tree import CERTIFY_DEPTH
from app.core.schemas import ListParams
from app.models.franchisee import Franchisee
from app.models.product import ProductNode
from app.models.territory import District, Pincode, PincodeDistrict, Region, State

# Rule 4: districts are territory data with no franchise of its own — the name
# tables are read by ids here rather than importing `features.geo`.


class _Root(NamedTuple):
    id: uuid.UUID
    name: str


async def _subquery(
    db: AsyncSession, company_id: uuid.UUID, franchisee_id: uuid.UUID
):
    """The codes this franchisee owns, and whether it is the home pool."""
    is_home = bool(
        await db.scalar(
            select(Franchisee.is_home).where(
                Franchisee.company_id == company_id,
                Franchisee.id == franchisee_id,
            )
        )
    )
    return franchisee_pincodes_subquery(
        company_id, franchisee_id, is_home=is_home
    )


async def technician_options(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> dict:
    """Both pickers of the portal's Add-technician form, in one response.

    The screen opens showing both — two round trips for one form whose every
    branch needs both is latency on the screen people use for every hire.
    """
    codes = await _subquery(db, company_id, franchisee_id)

    regions = [
        {"id": rid, "name": name}
        for rid, name in (
            await db.execute(
                select(Region.id, Region.name)
                .join(State, State.region_id == Region.id)
                .join(Pincode, Pincode.state_id == State.id)
                .where(Pincode.code.in_(codes))
                .distinct()
                .order_by(Region.name)
            )
        )
    ]
    nodes = [
        {"id": n.id, "name": n.name, "root_id": n.ancestor_ids[0]}
        for n in await db.scalars(
            select(ProductNode).where(
                ProductNode.company_id == company_id,
                ProductNode.deleted_at.is_(None),
                ProductNode.is_active.is_(True),
                ProductNode.depth == CERTIFY_DEPTH,
            )
        )
    ]
    if not nodes:
        return {"regions": regions, "subcategories": []}

    roots = {
        r.id: r
        for r in (
            _Root(*row)
            for row in await db.execute(
                select(ProductNode.id, ProductNode.name).where(
                    ProductNode.company_id == company_id,
                    ProductNode.id.in_({n["root_id"] for n in nodes}),
                    ProductNode.deleted_at.is_(None),
                )
            )
        )
    }
    subcategories = [
        {
            "id": n["id"],
            "name": n["name"],
            "rootId": n["root_id"],
            "rootName": roots[n["root_id"]].name if n["root_id"] in roots else "",
            "pathLabel": n["name"],
        }
        for n in sorted(
            nodes,
            key=lambda n: (roots[n["root_id"]].name if n["root_id"] in roots else "", n["name"]),
        )
    ]
    return {"regions": regions, "subcategories": subcategories}


async def pincodes(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    franchisee_id: uuid.UUID,
    params: ListParams,
    search: str | None,
    region_id: uuid.UUID | None,
) -> tuple[list[dict], int]:
    """This franchisee's pincodes, paginated — the coverage picker on Add.

    Search is a CODE PREFIX, deliberately narrower than `geo.list_pincodes`'s
    three-way match: the portal picks coverage from a map of codes, and a
    state or district is already visible on the row it picked from. Active
    codes only, exactly like every other picker that feeds offerable work.
    """
    codes = await _subquery(db, company_id, franchisee_id)
    stmt = (
        select(Pincode, State, Region)
        .join(State, State.id == Pincode.state_id)
        .join(Region, Region.id == State.region_id)
        .where(
            Pincode.code.in_(codes),
            Pincode.is_active.is_(True),
        )
    )
    if search and search.strip():
        stmt = stmt.where(Pincode.code.like(f"{search.strip()}%"))
    if region_id is not None:
        stmt = stmt.where(State.region_id == region_id)
    stmt = stmt.order_by(Pincode.code)

    total = await db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    rows = (
        await db.execute(stmt.limit(params.limit).offset(params.offset))
    ).all()

    # The districts of the page, one query — the same `_districts_of` shape
    # `geo.list_pincodes` ships, re-derived here rather than imported.
    page_codes = [p.code for p, _s, _r in rows]
    districts: dict[str, list[tuple[uuid.UUID, str]]] = defaultdict(list)
    if page_codes:
        joined = await db.execute(
            select(PincodeDistrict.pincode_code, District.id, District.name)
            .join(District, District.id == PincodeDistrict.district_id)
            .where(PincodeDistrict.pincode_code.in_(page_codes))
            .order_by(District.name)
        )
        for code, district_id, name in joined:
            districts[code].append((district_id, name))

    out = [
        {
            "code": p.code,
            "stateId": s.id,
            "stateName": s.name,
            "regionId": r.id,
            "regionName": r.name,
            "districts": [name for _id, name in districts[p.code]],
            "districtIds": [did for did, _name in districts[p.code]],
            "isActive": p.is_active,
            "source": p.source,
            # Task 10 (§4.7): the point a pincode base copies, or None.
            "latitude": p.latitude,
            "longitude": p.longitude,
        }
        for p, s, r in rows
    ]
    return out, int(total or 0)