"""Company (tenant) request/response models — superadmin console."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.schemas import AppModel


class CompanyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr  # becomes the admin's login email
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    adminName: str | None = Field(default=None, max_length=255)


class CompanyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)


class CompanyStatusRequest(BaseModel):
    isActive: bool


class CompanyOut(AppModel):
    id: uuid.UUID
    name: str
    slug: str
    email: str
    phone: str | None
    isActive: bool
    adminEmail: str | None = None
    userCount: int | None = None
    createdAt: datetime
