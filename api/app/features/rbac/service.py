"""RBAC logic: roles, feature catalog, and per-company role-feature overrides.

An override row exists only where a company diverges from the shipped default
(sparse). Setting a value back to the default deletes the override.
"""

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, ensure_below_rank
from app.features.rbac.schemas import (
    FeatureOut,
    RegionOut,
    RoleFeatureItem,
    RoleFeaturesOut,
    RoleOut,
)
from app.models.feature import CompanyRoleFeature, Feature, RoleFeatureDefault
from app.models.role import ROLE_RANKS, SUPERADMIN, Role
from app.models.territory import Region


async def list_roles(session: AsyncSession) -> list[RoleOut]:
    rows = await session.scalars(
        select(Role).where(Role.key != SUPERADMIN).order_by(Role.rank)
    )
    return [RoleOut(key=r.key, label=r.label, rank=r.rank) for r in rows]


async def list_regions(session: AsyncSession) -> list[RegionOut]:
    """The regions of India — global reference data, like the role catalog."""
    rows = await session.scalars(
        select(Region).where(Region.is_active.is_(True)).order_by(Region.sort_order)
    )
    return [RegionOut(id=r.id, code=r.code, name=r.name) for r in rows]


async def list_features(session: AsyncSession) -> list[FeatureOut]:
    rows = await session.scalars(
        select(Feature).where(Feature.is_active.is_(True)).order_by(
            Feature.sort_order, Feature.key
        )
    )
    return [
        FeatureOut(
            key=f.key, label=f.label, parentKey=f.parent_key, sortOrder=f.sort_order
        )
        for f in rows
    ]


def _check_manageable_role(principal: Principal, role: str) -> None:
    if role == SUPERADMIN or role not in ROLE_RANKS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    ensure_below_rank(principal, role)  # only roles below the actor


_ROLE_FEATURES_SQL = text(
    """
    SELECT f.key, f.label, rfd.enabled AS default_enabled, cro.enabled AS override_enabled
    FROM features f
    LEFT JOIN role_feature_defaults rfd
           ON rfd.feature_id = f.id AND rfd.role = :role
    LEFT JOIN company_role_features cro
           ON cro.feature_id = f.id AND cro.role = :role AND cro.company_id = :company_id
    WHERE f.is_active
    ORDER BY f.sort_order, f.key
    """
)


async def get_role_features(
    session: AsyncSession, principal: Principal, role: str
) -> RoleFeaturesOut:
    _check_manageable_role(principal, role)
    result = await session.execute(
        _ROLE_FEATURES_SQL, {"role": role, "company_id": principal.company_id}
    )
    items = []
    for row in result:
        override = row.override_enabled
        enabled = override if override is not None else bool(row.default_enabled)
        items.append(
            RoleFeatureItem(
                key=row.key,
                label=row.label,
                enabled=enabled,
                isOverride=override is not None,
            )
        )
    return RoleFeaturesOut(role=role, features=items)


async def update_role_features(
    session: AsyncSession, principal: Principal, role: str, changes: dict[str, bool]
) -> RoleFeaturesOut:
    _check_manageable_role(principal, role)
    company_id = principal.company_id

    for key, value in changes.items():
        feature = await session.scalar(select(Feature).where(Feature.key == key))
        if feature is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown feature: {key}",
            )
        default = await session.scalar(
            select(RoleFeatureDefault.enabled).where(
                RoleFeatureDefault.role == role,
                RoleFeatureDefault.feature_id == feature.id,
            )
        )
        default = bool(default)
        override = await session.scalar(
            select(CompanyRoleFeature).where(
                CompanyRoleFeature.company_id == company_id,
                CompanyRoleFeature.role == role,
                CompanyRoleFeature.feature_id == feature.id,
            )
        )
        if value == default:
            # Back to default → drop the override to stay sparse.
            if override is not None:
                await session.delete(override)
        elif override is not None:
            override.enabled = value
            override.updated_by = principal.user_id
        else:
            session.add(
                CompanyRoleFeature(
                    company_id=company_id,
                    role=role,
                    feature_id=feature.id,
                    enabled=value,
                    created_by=principal.user_id,
                )
            )
    await session.commit()
    return await get_role_features(session, principal, role)
