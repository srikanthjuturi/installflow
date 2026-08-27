"""Company user (membership) request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.phone import OptionalPhone
from app.core.images import ImageUrl
from app.core.schemas import AppModel


class UserCreateRequest(BaseModel):
    email: EmailStr
    role: str
    fullName: str | None = Field(default=None, max_length=255)
    phone: OptionalPhone = None
    # Required only when the email is new (a fresh identity). Ignored on reuse.
    password: str | None = Field(default=None, min_length=8, max_length=128)
    profileImageUrl: ImageUrl = None
    managerId: uuid.UUID | None = None  # a membership id in the same company
    # Territory. Which of these is required depends on the role — see the
    # service; a regional head needs regions, an area manager states, a
    # national head neither (all India).
    #
    # An area manager sends ONLY `stateIds`. His regions are derived from those
    # states rather than sent, because a client-supplied region that disagreed
    # with the states would be two answers to one question.
    regionIds: list[uuid.UUID] = Field(default_factory=list)
    stateIds: list[uuid.UUID] = Field(default_factory=list)


class UserUpdateRequest(BaseModel):
    fullName: str | None = Field(default=None, max_length=255)
    phone: OptionalPhone = None
    profileImageUrl: ImageUrl = None
    isActive: bool | None = None
    managerId: uuid.UUID | None = None
    # Omit to leave the territory untouched; send a list to REPLACE it.
    regionIds: list[uuid.UUID] | None = None
    stateIds: list[uuid.UUID] | None = None


class RegionOut(AppModel):
    id: uuid.UUID
    code: str
    name: str


class StateOut(AppModel):
    id: uuid.UUID
    name: str
    regionId: uuid.UUID
    regionName: str


class UserOut(AppModel):
    membershipId: uuid.UUID
    userId: uuid.UUID
    #: Null for a technician, who is identified by phone.
    email: str | None
    fullName: str | None
    phone: str | None
    role: str
    roleLabel: str
    profileImageUrl: str | None
    isActive: bool
    managerId: uuid.UUID | None
    #: Who APPOINTED this user — `memberships.created_by`, the manager who
    #: was acting when the row was written. NOT `managerId`: that is the
    #: reporting line and is allowed to point somewhere else entirely.
    #: Null on a system-seeded row, which the table renders as a dash.
    appointedById: uuid.UUID | None
    appointedBy: str | None
    regions: list[RegionOut]
    #: An area manager's states. His pincode coverage is every code inside
    #: them, derived from the master — it is deliberately NOT returned here,
    #: because one state can hold nearly two thousand.
    states: list[StateOut]
    scopeLabel: str
    createdAt: datetime
