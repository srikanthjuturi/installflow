"""Tenant-scoping and pagination helpers shared by the feature slices.

`tenant_scope` is the single choke point that injects the active company_id (and
the not-deleted filter) into a query — slices call this instead of hand-writing
`WHERE company_id = ...`, so a tenant filter can't be forgotten.
"""

import uuid
from typing import TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


def tenant_scope(stmt: Select, model: type, company_id: uuid.UUID) -> Select:
    """Restrict a query to one company's non-deleted rows."""
    stmt = stmt.where(model.company_id == company_id)
    if hasattr(model, "deleted_at"):
        stmt = stmt.where(model.deleted_at.is_(None))
    return stmt


async def paginate(
    session: AsyncSession, stmt: Select, *, page: int, limit: int
) -> tuple[list, int]:
    """Return (rows, total) for a page. Total is counted over the full query."""
    total = await session.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    result = await session.scalars(stmt.limit(limit).offset((page - 1) * limit))
    return list(result.all()), int(total or 0)
