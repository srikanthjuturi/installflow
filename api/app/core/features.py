"""Effective feature resolution — the backend-driven show/hide source of truth.

effective = COALESCE(company_override.enabled, role_default.enabled, false)

Superadmin short-circuits to a fixed platform feature set (company management)
and never touches the per-company tables.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import SUPERADMIN

# Platform features for the superadmin console (create/list/edit/delete companies).
SUPERADMIN_FEATURES: list[str] = [
    "companies.view",
    "companies.create",
    "companies.edit",
    "companies.delete",
]

_EFFECTIVE_SQL = text(
    """
    SELECT f.key
    FROM features f
    LEFT JOIN role_feature_defaults rfd
           ON rfd.feature_id = f.id AND rfd.role = :role
    LEFT JOIN company_role_features cro
           ON cro.feature_id = f.id AND cro.role = :role
          AND cro.company_id = :company_id
    WHERE f.is_active
      AND COALESCE(cro.enabled, rfd.enabled, false)
    ORDER BY f.sort_order, f.key
    """
)


async def effective_features(
    session: AsyncSession,
    *,
    role: str,
    company_id: uuid.UUID | None,
) -> list[str]:
    if role == SUPERADMIN:
        return list(SUPERADMIN_FEATURES)
    result = await session.execute(
        _EFFECTIVE_SQL, {"role": role, "company_id": company_id}
    )
    return [row.key for row in result]
