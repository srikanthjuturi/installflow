"""Auth request/response models (camelCase on the wire, matching the frontend)."""

import uuid

from pydantic import BaseModel, EmailStr, Field

from app.core.schemas import AppModel


# ─── Requests ──────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class SwitchCompanyRequest(BaseModel):
    companyId: uuid.UUID


class RefreshRequest(BaseModel):
    refreshToken: str


class LogoutRequest(BaseModel):
    refreshToken: str | None = None


# ─── Response fragments ────────────────────────────────────────────────────
class UserOut(AppModel):
    id: uuid.UUID
    email: str
    fullName: str | None
    phone: str | None
    role: str
    roleLabel: str
    profileImageUrl: str | None
    isSuperadmin: bool


class MembershipOut(AppModel):
    companyId: uuid.UUID
    companyName: str
    companySlug: str
    role: str
    isActive: bool


class CompanyOut(AppModel):
    id: uuid.UUID
    name: str
    slug: str
    email: str
    phone: str | None
    isActive: bool


# ─── Response payloads ─────────────────────────────────────────────────────
class LoginResponse(AppModel):
    user: UserOut
    memberships: list[MembershipOut]
    activeCompanyId: uuid.UUID | None
    accessToken: str
    refreshToken: str
    tokenType: str = "bearer"


class SwitchCompanyResponse(AppModel):
    accessToken: str
    activeCompanyId: uuid.UUID


class RefreshResponse(AppModel):
    accessToken: str
    refreshToken: str
    tokenType: str = "bearer"


class RegionOut(AppModel):
    id: uuid.UUID
    code: str
    name: str


class MeResponse(AppModel):
    user: UserOut
    activeCompany: CompanyOut | None
    role: str
    features: list[str]
    memberships: list[MembershipOut]
    # The caller's OWN territory — what they cover, and what they may hand out.
    regions: list[RegionOut]
    pincodes: list[str]
    scopeLabel: str
