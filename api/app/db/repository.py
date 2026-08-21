"""Tenant- and territory-scoping plus pagination, shared by the feature slices.

`tenant_scope` is the single choke point that injects the active company_id (and
the not-deleted filter) into a query — slices call this instead of hand-writing
`WHERE company_id = ...`, so a tenant filter can't be forgotten. `territory_scope`
is the same idea one level down: which slice of the company you may see.
"""

import uuid
from typing import TypeVar

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope import ALL_INDIA_ROLES, Scope
from app.models.membership import Membership
from app.models.role import AREA_MANAGER, REGIONAL_HEAD
from app.models.territory import MembershipRegion, MembershipState

T = TypeVar("T")


def tenant_scope(stmt: Select, model: type, company_id: uuid.UUID) -> Select:
    """Restrict a query to one company's non-deleted rows."""
    stmt = stmt.where(model.company_id == company_id)
    if hasattr(model, "deleted_at"):
        stmt = stmt.where(model.deleted_at.is_(None))
    return stmt


def territory_scope(
    stmt: Select,
    *,
    role: str,
    own_membership_id: uuid.UUID | None,
    own_scope: Scope,
) -> Select:
    """Restrict a membership query to the territory the caller may see.

    - all-India roles (admin, national head) see the whole company;
    - a regional head sees memberships in one of their regions;
    - an area manager sees memberships sharing one of their states.

    Everyone always sees their own row, so a manager never loses themselves from
    their own list. Applied to reads AND to fetch-by-id, so guessing another
    region's membership id returns 404 rather than leaking it.
    """
    if role in ALL_INDIA_ROLES:
        return stmt

    mine = Membership.id == own_membership_id

    if role == REGIONAL_HEAD:
        region_ids = own_scope.region_ids
        if not region_ids:
            return stmt.where(mine)
        in_my_regions = (
            select(MembershipRegion.membership_id)
            .where(MembershipRegion.region_id.in_(region_ids))
            .scalar_subquery()
        )
        return stmt.where(or_(mine, Membership.id.in_(in_my_regions)))

    if role == AREA_MANAGER:
        state_ids = own_scope.state_ids
        if not state_ids:
            return stmt.where(mine)
        in_my_states = (
            select(MembershipState.membership_id)
            .where(MembershipState.state_id.in_(state_ids))
            .scalar_subquery()
        )
        return stmt.where(or_(mine, Membership.id.in_(in_my_states)))

    # Any other role (e.g. technician) sees only themselves.
    return stmt.where(mine)


async def paginate(
    session: AsyncSession, stmt: Select, *, page: int, limit: int
) -> tuple[list, int]:
    """Return (rows, total) for a page. Total is counted over the full query."""
    total = await session.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    result = await session.scalars(stmt.limit(limit).offset((page - 1) * limit))
    return list(result.all()), int(total or 0)
