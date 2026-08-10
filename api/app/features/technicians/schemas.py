"""Technician request/response models.

The list is a UNION of two very different rows — a registered technician and a
phone number that has only been invited — so `TechnicianRowOut` is
discriminated on `registered`. Everything a pending invite cannot know is
nullable, and the console renders those as an em dash rather than inventing a
zero.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.core.phone import Phone
from app.core.schemas import AppModel

Pincode = Annotated[str, Field(pattern=r"^[0-9]{6}$")]
DailyJobCap = Annotated[int, Field(ge=1, le=12)]

OnboardingMode = Literal["invite", "direct"]
RegisteredBy = Literal["self", "manager"]
TechnicianStatus = Literal["active", "inactive", "suspended"]
InviteStatus = Literal["pending", "sent", "failed", "registered", "cancelled", "expired"]


# ── requests ──────────────────────────────────────────────────────────────────


class TechnicianCreateRequest(BaseModel):
    """Direct onboarding: the manager fills in everything."""

    fullName: str = Field(min_length=2, max_length=255)
    phone: Phone
    profileImageUrl: str | None = None
    #: Optional when the caller holds exactly one region (every area manager).
    regionId: uuid.UUID | None = None
    #: Who the technician reports to. Defaults to the creator's own membership.
    managerId: uuid.UUID | None = None
    subcategoryIds: list[uuid.UUID] = Field(min_length=1)
    pincodes: list[Pincode] = Field(min_length=1, max_length=50)
    dailyJobCap: DailyJobCap = 5


class TechnicianUpdateRequest(BaseModel):
    """Omit a field to leave it alone; send a list to REPLACE it."""

    fullName: str | None = Field(default=None, min_length=2, max_length=255)
    profileImageUrl: str | None = None
    regionId: uuid.UUID | None = None
    managerId: uuid.UUID | None = None
    subcategoryIds: list[uuid.UUID] | None = None
    pincodes: list[Pincode] | None = None
    dailyJobCap: DailyJobCap | None = None
    status: TechnicianStatus | None = None


class InviteCreateRequest(BaseModel):
    """Invite onboarding: a phone number and nothing else is required."""

    phone: Phone
    regionId: uuid.UUID | None = None
    managerId: uuid.UUID | None = None
    dailyJobCap: DailyJobCap = 5


# ── responses ─────────────────────────────────────────────────────────────────


class SubcategoryRef(AppModel):
    id: uuid.UUID
    name: str
    categoryName: str


class OnboardingOut(AppModel):
    """The tracking half: who appointed, who registered, and when."""

    mode: OnboardingMode
    registeredBy: RegisteredBy
    appointedByName: str | None
    appointedByEmail: str | None
    appointedAt: datetime
    registeredAt: datetime


class TechnicianOut(AppModel):
    registered: Literal[True] = True
    id: uuid.UUID
    membershipId: uuid.UUID
    userId: uuid.UUID
    code: str
    name: str
    phone: str
    profileImageUrl: str | None
    isActive: bool
    status: TechnicianStatus

    regionId: uuid.UUID
    regionName: str
    subcategories: list[SubcategoryRef]
    pincodes: list[str]

    dailyJobCap: int
    #: Jobs in flight today. Always 0 until the jobs slice exists — it is
    #: derived from open assignments, not stored.
    bwUsed: int = 0
    rating: float | None
    jobsCompleted: int
    jobsCancelled: int
    onTimePct: int | None

    onboarding: OnboardingOut
    createdAt: datetime


class TechnicianInviteOut(AppModel):
    registered: Literal[False] = False
    id: uuid.UUID
    phone: str
    status: InviteStatus
    regionId: uuid.UUID
    regionName: str
    #: Who sent the link — the tracking half of the invite path.
    invitedByName: str | None
    invitedByEmail: str | None
    #: The deep link. Shown so a manager can copy it when WhatsApp refuses.
    inviteLink: str
    #: Why WhatsApp refused, when it did.
    failureReason: str | None
    dailyJobCap: int
    sentAt: datetime | None
    registeredAt: datetime | None
    expiresAt: datetime
    createdAt: datetime


#: One row of the Technicians screen: either half of the union.
TechnicianRowOut = TechnicianOut | TechnicianInviteOut


class TechnicianDetailOut(TechnicianOut):
    """The profile page. Same shape today; kept apart so it can grow."""


class TechnicianSessionOut(AppModel):
    """What the mobile app needs about itself right after signing in.

    Non-null on a login response is the signal that this account is a
    technician and its onboarding is complete — so the app can go straight to
    Home without a second round trip.
    """

    id: uuid.UUID
    code: str
    name: str
    phone: str
    profileImageUrl: str | None
    regionName: str
    #: Display-only, e.g. "Videocon · West Zone" — who onboarded them.
    onboardedBy: str
    subcategories: list[SubcategoryRef]
    pincodes: list[str]
    dailyJobCap: int
    status: TechnicianStatus
