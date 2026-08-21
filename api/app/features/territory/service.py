"""The territory picture, derived from user assignments.

There are no mapping records: a region's regional heads and area managers ARE
the memberships scoped to it, so assigning a user is what maps the territory.
A region with nobody in it is still returned — an unmapped region is
information, not an empty row to hide.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.scope import ALL_INDIA_ROLES, load_scopes, own_scope
from app.db.repository import territory_scope
from app.features.territory.schemas import (
    TerritoryAreaManager,
    TerritoryPerson,
    TerritoryRegion,
)
from app.models.membership import Membership
from app.models.role import AREA_MANAGER, REGIONAL_HEAD
from app.models.territory import MembershipState, Region, State
from app.models.user import User


async def get_territory(
    session: AsyncSession, principal: Principal
) -> list[TerritoryRegion]:
    own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )

    regions = list(
        (
            await session.scalars(
                select(Region)
                .where(Region.is_active.is_(True))
                .order_by(Region.sort_order)
            )
        ).all()
    )
    # All-India roles see the whole map; anyone else sees only their own
    # regions, so the page can't invite them to act somewhere they'd be refused.
    if principal.role not in ALL_INDIA_ROLES:
        regions = [r for r in regions if r.id in own.region_ids]
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

    # Every state in the visible regions, so the view can name the ones nobody
    # covers. An unassigned state is the actionable fact here — a count of
    # covered ones tells nobody what to do next.
    all_states = list(
        (
            await session.scalars(
                select(State)
                .where(State.region_id.in_([r.id for r in regions]))
                .order_by(State.name)
            )
        ).all()
    ) if regions else []

    # Which states are taken, across the WHOLE company — not just the managers
    # this caller can see. `rows` above is territory-filtered, so computing it
    # from there told a regional head a state was free when another region's
    # manager already held it, and assigning it then 409'd.
    taken: set[uuid.UUID] = set(
        (
            await session.scalars(
                select(MembershipState.state_id).where(
                    MembershipState.company_id == principal.company_id
                )
            )
        ).all()
    )

    out: list[TerritoryRegion] = []
    for region in regions:
        heads: list[TerritoryPerson] = []
        managers: list[TerritoryAreaManager] = []

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
                # An area manager may span regions, so show only the states of
                # HIS that belong to the region being drawn.
                here = [s for s in scope.states if s.region_id == region.id]
                managers.append(
                    TerritoryAreaManager(
                        membershipId=membership.id,
                        name=user.full_name or user.email,
                        email=user.email,
                        isActive=membership.is_active,
                        states=[s.name for s in here],
                    )
                )

        in_region = [s for s in all_states if s.region_id == region.id]
        out.append(
            TerritoryRegion(
                id=region.id,
                code=region.code,
                name=region.name,
                regionalHeads=heads,
                areaManagers=managers,
                unassignedStates=[s.name for s in in_region if s.id not in taken],
                stateCount=len(in_region),
            )
        )
    return out
