"""Company user (membership) request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.schemas import AppModel


class UserCreateRequest(BaseModel):
    email: EmailStr
    role: str
    fullName: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    # Required only when the email is new (a fresh identity). Ignored on reuse.
    password: str | None = Field(default=None, min_length=8, max_length=128)
    profileImageUrl: str | None = None
    managerId: uuid.UUID | None = None  # a membership id in the same company


class UserUpdateRequest(BaseModel):
    fullName: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    profileImageUrl: str | None = None
    isActive: bool | None = None
    managerId: uuid.UUID | None = None


class UserOut(AppModel):
    membershipId: uuid.UUID
    userId: uuid.UUID
    email: str
    fullName: str | None
    phone: str | None
    role: str
    roleLabel: str
    profileImageUrl: str | None
    isActive: bool
    managerId: uuid.UUID | None
    createdAt: datetime
