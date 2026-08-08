"""The territory picture, derived from user assignments.

There are no mapping records: a region's regional heads and area managers ARE
the memberships scoped to it, so assigning a user is what maps the territory.
A region with nobody in it is still returned — an unmapped region is
information, not an empty row to hide.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.scope import load_scopes, own_scope
from app.db.repository import territory_scope
from app.features.territory.schemas import (
    TerritoryAreaManager,
    TerritoryPerson,
    TerritoryRegion,
)
from app.models.membership import Membership
from app.models.role import AREA_MANAGER, REGIONAL_HEAD
from app.models.territory import Region
from app.models.user import User


async def get_territory(
    session: AsyncSession, principal: Principal
) -> list[TerritoryRegion]:
    regions = list(
        (
            await session.scalars(
                select(Region)
                .where(Region.is_active.is_(True))
                .order_by(Region.sort_order)
            )
        ).all()
    )

    own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
            User.role.in_([REGIONAL_HEAD, AREA_MANAGER]),
        )
        .order_by(User.full_name)
    )
    # A regional head sees only their own regions here too.
    stmt = territory_scope(
        stmt, role=principal.role, own_membership_id=own_id, own_scope=own
    )
    rows = (await session.execute(stmt)).all()
    scopes = await load_scopes(session, [m.id for m, _u in rows])

    out: list[TerritoryRegion] = []
    for region in regions:
        heads: list[TerritoryPerson] = []
        managers: list[TerritoryAreaManager] = []
        pincode_count = 0

        for membership, user in rows:
            scope = scopes[membership.id]
            if region.id not in scope.region_ids:
                continue
            if user.role == REGIONAL_HEAD:
                heads.append(
                    TerritoryPerson(
                        membershipId=membership.id,
                        name=user.full_name or user.email,
                        email=user.email,
                        isActive=membership.is_active,
                    )
                )
            else:
                managers.append(
                    TerritoryAreaManager(
                        membershipId=membership.id,
                        name=user.full_name or user.email,
                        email=user.email,
                        isActive=membership.is_active,
                        pincodes=list(scope.pincodes),
                    )
                )
                pincode_count += len(scope.pincodes)

        out.append(
            TerritoryRegion(
                id=region.id,
                code=region.code,
                name=region.name,
                regionalHeads=heads,
                areaManagers=managers,
                pincodeCount=pincode_count,
            )
        )
    return out
