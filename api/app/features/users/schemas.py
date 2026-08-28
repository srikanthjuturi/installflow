"""Company user (membership) request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.phone import OptionalPhone
from app.core.images import ImageUrl
from app.core.schemas import AppModel, EmailOutcome


class UserCreateRequest(BaseModel):
    # NB: there is deliberately no `password`. The server mints a temporary one
    # and emails it — see `app.emails.send_temporary_password`. The field was
    # deleted rather than deprecated: pydantic ignores unknown keys, so a client
    # still sending one would get a 201 and have it silently discarded, and
    # somebody would hand over a credential that does not work.
    email: EmailStr
    role: str
    fullName: str | None = Field(default=None, max_length=255)
    phone: OptionalPhone = None
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


class UserCreatedOut(UserOut, EmailOutcome):
    """`POST /users` and the reissue only.

    A subclass rather than a wrapper: wrapping would push every field above down
    a level and break the console's `onSuccess: (u) => u.fullName`, and widening
    `UserOut` itself would add three permanently-null fields to the list, get
    and update responses. This is purely additive.
    """
