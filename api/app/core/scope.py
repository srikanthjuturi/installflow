"""Territory scope: reading a member's regions/states and describing them.

Shared by the users slice (assignment + listing), `/auth/me` (your own scope)
and the territory view. Kept in one place so "what does this person cover"
has a single answer.

**A scope never holds pincodes.** An area manager covers every pincode in his
states, which is thousands of strings — Uttar Pradesh alone is 1,667 — and
`load_scopes` runs on every page of the user list. Everything that needs to ask
"is this pincode mine?" does it as a subquery against the `pincodes` master
instead: `pincodes_in_states` below is the one place that predicate is written.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership import Membership
from app.models.role import ADMIN, AREA_MANAGER, NATIONAL_HEAD, REGIONAL_HEAD, SUPERADMIN
from app.models.territory import MembershipRegion, MembershipState, Pincode, Region, State

# Roles whose reach is the whole country — they hold no scope rows.
ALL_INDIA_ROLES = frozenset({SUPERADMIN, ADMIN, NATIONAL_HEAD})
ALL_INDIA_LABEL = "All India"


@dataclass
class Scope:
    """One member's territory: regions, and (for an area manager) states."""

    regions: list[Region] = field(default_factory=list)
    states: list[State] = field(default_factory=list)

    @property
    def region_ids(self) -> set[uuid.UUID]:
        return {r.id for r in self.regions}

    @property
    def state_ids(self) -> set[uuid.UUID]:
        return {s.id for s in self.states}


def pincodes_in_states(state_ids: set[uuid.UUID] | list[uuid.UUID]) -> Select:
    """Codes covered by these states, as a SUBQUERY — never a materialised list.

    Used wherever a pincode has to be tested against somebody's territory
    (ticket visibility, technician coverage). Returning a query rather than
    rows is the whole point: Postgres does the filtering, and a three-state
    area manager does not drag 6,000 strings through Python to answer one
    yes/no question.
    """
    return select(Pincode.code).where(Pincode.state_id.in_(list(state_ids)))


def pincodes_in_regions(region_ids: set[uuid.UUID] | list[uuid.UUID]) -> Select:
    """The same idea one level up — every code in these regions."""
    return select(Pincode.code).where(
        Pincode.state_id.in_(
            select(State.id).where(State.region_id.in_(list(region_ids)))
        )
    )


async def load_scopes(
    session: AsyncSession, membership_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Scope]:
    """Batch-load scope for many memberships — one query each, never N+1."""
    scopes: dict[uuid.UUID, Scope] = {mid: Scope() for mid in membership_ids}
    if not membership_ids:
        return scopes

    rows = await session.execute(
        select(MembershipRegion.membership_id, Region)
        .join(Region, Region.id == MembershipRegion.region_id)
        .where(MembershipRegion.membership_id.in_(membership_ids))
        .order_by(Region.sort_order)
    )
    for membership_id, region in rows:
        scopes[membership_id].regions.append(region)

    states = await session.execute(
        select(MembershipState.membership_id, State)
        .join(State, State.id == MembershipState.state_id)
        .where(MembershipState.membership_id.in_(membership_ids))
        .order_by(State.name)
    )
    for membership_id, state in states:
        scopes[membership_id].states.append(state)

    return scopes


async def load_scope(session: AsyncSession, membership_id: uuid.UUID) -> Scope:
    return (await load_scopes(session, [membership_id]))[membership_id]


async def own_scope(
    session: AsyncSession, *, user_id: uuid.UUID, company_id: uuid.UUID | None
) -> tuple[uuid.UUID | None, Scope]:
    """The caller's own membership id and territory in the active company.

    Takes ids rather than a Principal so this module stays free of the request
    layer. Returns `(None, empty)` for anyone without a membership (superadmin).
    """
    if company_id is None:
        return None, Scope()

    membership_id = await session.scalar(
        select(Membership.id).where(
            Membership.user_id == user_id,
            Membership.company_id == company_id,
            Membership.deleted_at.is_(None),
        )
    )
    if membership_id is None:
        return None, Scope()
    return membership_id, await load_scope(session, membership_id)


def scope_label(role: str, scope: Scope) -> str:
    """A human summary for a list column.

    'All India' / 'North, West' / 'South · 2 states'. An area manager is
    counted in STATES, not pincodes: the pincode total would be derived from the
    master and is not what anybody assigned him. The names themselves are on
    `states`, so a caller that has room can list them.
    """
    if role in ALL_INDIA_ROLES:
        return ALL_INDIA_LABEL
    if role == REGIONAL_HEAD:
        return ", ".join(r.name for r in scope.regions) or "No region"
    if role == AREA_MANAGER:
        if not scope.states:
            return "No states"
        regions = ", ".join(r.name for r in scope.regions) or "No region"
        count = len(scope.states)
        return f"{regions} · {count} state{'' if count == 1 else 's'}"
    return "—"
