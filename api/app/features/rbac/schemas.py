"""RBAC request/response models: roles, feature catalog, role-feature overrides."""

from pydantic import BaseModel

from app.core.schemas import AppModel


class RoleOut(AppModel):
    key: str
    label: str
    rank: int


class FeatureOut(AppModel):
    key: str
    label: str
    parentKey: str | None
    sortOrder: int


class RoleFeatureItem(BaseModel):
    key: str
    label: str
    enabled: bool
    isOverride: bool  # true if the company overrides the shipped default


class RoleFeaturesOut(BaseModel):
    role: str
    features: list[RoleFeatureItem]


class RoleFeaturesUpdateRequest(BaseModel):
    role: str
    features: dict[str, bool]  # feature key -> enabled
