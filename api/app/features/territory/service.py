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
    TerritoryState,
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

    # An area manager's territory is his STATES, not the region they sit in.
    #
    # He used to get every state in that region — Arunachal Pradesh's manager
    # saw all thirteen of North — with only his own marked "mine". That was a
    # deliberate design once, and it is the wrong one: he cannot assign a
    # manager, cannot open a technician list outside his own coverage, and
    # cannot act on a gap in Uttar Pradesh. Showing it invited him to try, and
    # the state panel went as far as offering him an "Assign an Area Manager"
    # button linking to a screen his role cannot even load.
    #
    # Filtered here rather than in the console, because hiding a state in the
    # UI is presentation and this is scope. Everything he does not cover then
    # falls through the client's "not in the payload" branch and is drawn grey
    # and inert, exactly as another region's states already were.
    #
    # What it costs: he no longer sees that a neighbouring state in his region
    # has no manager. That is a regional head's question, and they still get it.
    if principal.role == AREA_MANAGER:
        all_states = [s for s in all_states if s.id in own.state_ids]

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

    # state_id -> the area manager covering it. Built from the memberships this
    # caller can SEE, so a regional head is told "covered" for a state held by a
    # manager outside their regions without being shown who — `taken` already
    # knows it is not free.
    covering: dict[uuid.UUID, TerritoryPerson] = {}
    for membership, user in rows:
        if user.role != AREA_MANAGER:
            continue
        person = TerritoryPerson(
            membershipId=membership.id,
            name=user.full_name or user.email,
            email=user.email,
            isActive=membership.is_active,
        )
        for state in scopes[membership.id].states:
            covering[state.id] = person

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
                states=[
                    TerritoryState(
                        id=s.id,
                        name=s.name,
                        # `taken` is company-wide; `covering` is only what this
                        # caller may see. A state can therefore be covered with
                        # no name attached, which is the honest answer rather
                        # than reporting it free.
                        isCovered=s.id in taken,
                        coveredBy=covering.get(s.id),
                        # All-India covers everything; a regional head is
                        # responsible for every state in their regions; an area
                        # manager only for the states actually assigned to him.
                        isMine=(
                            principal.role in ALL_INDIA_ROLES
                            or s.id in own.state_ids
                            or (not own.state_ids and region.id in own.region_ids)
                        ),
                    )
                    for s in in_region
                ],
            )
        )
    return out
