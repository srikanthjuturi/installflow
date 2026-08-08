"""Company user (membership) request/response models."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field

from app.core.schemas import AppModel


Pincode = Annotated[str, Field(pattern=r"^[0-9]{6}$")]


class UserCreateRequest(BaseModel):
    email: EmailStr
    role: str
    fullName: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    # Required only when the email is new (a fresh identity). Ignored on reuse.
    password: str | None = Field(default=None, min_length=8, max_length=128)
    profileImageUrl: str | None = None
    managerId: uuid.UUID | None = None  # a membership id in the same company
    # Territory. Which of these is required depends on the role — see the
    # service; a regional head needs regions, an area manager one region and
    # its pincodes, a national head neither (all India).
    regionIds: list[uuid.UUID] = Field(default_factory=list)
    pincodes: list[Pincode] = Field(default_factory=list)


class UserUpdateRequest(BaseModel):
    fullName: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    profileImageUrl: str | None = None
    isActive: bool | None = None
    managerId: uuid.UUID | None = None
    # Omit to leave the territory untouched; send a list to REPLACE it.
    regionIds: list[uuid.UUID] | None = None
    pincodes: list[Pincode] | None = None


class RegionOut(AppModel):
    id: uuid.UUID
    code: str
    name: str


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
    regions: list[RegionOut]
    pincodes: list[str]
    scopeLabel: str
    createdAt: datetime
