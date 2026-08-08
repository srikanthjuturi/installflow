"""RBAC endpoints: roles, feature catalog, and per-company role-feature overrides."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CompanyPrincipal, Principal, require_feature
from app.core.schemas import ApiEnvelope, envelope
from app.features.rbac import service
from app.features.rbac.schemas import (
    FeatureOut,
    RegionOut,
    RoleFeaturesOut,
    RoleFeaturesUpdateRequest,
    RoleOut,
)

router = APIRouter(tags=["rbac"])

Db = Annotated[AsyncSession, Depends(get_db)]
ManageFeatures = Annotated[Principal, Depends(require_feature("features.manage"))]


@router.get("/roles", response_model=ApiEnvelope[list[RoleOut]])
async def list_roles(principal: CompanyPrincipal, db: Db) -> ApiEnvelope[list[RoleOut]]:
    return envelope(await service.list_roles(db))


@router.get("/regions", response_model=ApiEnvelope[list[RegionOut]])
async def list_regions(
    principal: CompanyPrincipal, db: Db
) -> ApiEnvelope[list[RegionOut]]:
    return envelope(await service.list_regions(db))


@router.get("/features", response_model=ApiEnvelope[list[FeatureOut]])
async def list_features(
    principal: ManageFeatures, db: Db
) -> ApiEnvelope[list[FeatureOut]]:
    return envelope(await service.list_features(db))


@router.get("/role-features", response_model=ApiEnvelope[RoleFeaturesOut])
async def get_role_features(
    principal: ManageFeatures,
    db: Db,
    role: Annotated[str, Query()],
) -> ApiEnvelope[RoleFeaturesOut]:
    return envelope(await service.get_role_features(db, principal, role))


@router.put("/role-features", response_model=ApiEnvelope[RoleFeaturesOut])
async def update_role_features(
    body: RoleFeaturesUpdateRequest,
    principal: ManageFeatures,
    db: Db,
) -> ApiEnvelope[RoleFeaturesOut]:
    data = await service.update_role_features(db, principal, body.role, body.features)
    return envelope(data, message="Feature access updated")
