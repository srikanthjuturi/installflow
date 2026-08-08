"""Territory scope: reading a member's regions/pincodes and describing them.

Shared by the users slice (assignment + listing), `/auth/me` (your own scope)
and the territory view. Kept in one place so "what does this person cover"
has a single answer.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership import Membership
from app.models.role import ADMIN, AREA_MANAGER, NATIONAL_HEAD, REGIONAL_HEAD, SUPERADMIN
from app.models.territory import MembershipPincode, MembershipRegion, Region

# Roles whose reach is the whole country — they hold no scope rows.
ALL_INDIA_ROLES = frozenset({SUPERADMIN, ADMIN, NATIONAL_HEAD})
ALL_INDIA_LABEL = "All India"


@dataclass
class Scope:
    """One member's territory."""

    regions: list[Region] = field(default_factory=list)
    pincodes: list[str] = field(default_factory=list)

    @property
    def region_ids(self) -> set[uuid.UUID]:
        return {r.id for r in self.regions}


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

    pins = await session.execute(
        select(MembershipPincode.membership_id, MembershipPincode.pincode)
        .where(MembershipPincode.membership_id.in_(membership_ids))
        .order_by(MembershipPincode.pincode)
    )
    for membership_id, pincode in pins:
        scopes[membership_id].pincodes.append(pincode)

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
    """A human summary for a list column: 'All India' / 'North, West' / 'North · 3 pincodes'."""
    if role in ALL_INDIA_ROLES:
        return ALL_INDIA_LABEL
    if role == REGIONAL_HEAD:
        return ", ".join(r.name for r in scope.regions) or "No region"
    if role == AREA_MANAGER:
        region = scope.regions[0].name if scope.regions else "No region"
        count = len(scope.pincodes)
        return f"{region} · {count} pincode{'s' if count != 1 else ''}"
    return "—"
