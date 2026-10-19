"""Franchisee request/response models (03 §4.4).

Create takes NO pincodes (Task 08's adoption of the single carve-out path):
pincodes always go through `PUT …/pincodes`, so a dry run always has a
franchisee id to diff against and there is exactly one plan-and-apply to test.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.core.phone import OptionalPhone, Phone
from app.core.schemas import AppModel, EmailOutcome

FranchiseeKind = Literal["internal", "external"]  # = app.models.franchisee.KINDS


class FranchiseeAdminIn(BaseModel):
    fullName: str = Field(min_length=2, max_length=255)
    email: EmailStr
    #: Mandatory for every console user — the only way to reach somebody whose
    #: mailbox bounces (the same reasoning as `UserCreateRequest.phone`).
    phone: Phone


class FranchiseeCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)  # stripped; unique per company on lower()
    #: Optional. Supplied → used as-is (uppercased, 2–8 alnum starting with a
    #: letter, unique per company, never HOME); omitted → derived from the name
    #: and uniquified. Stamped once, never editable afterwards.
    code: str | None = Field(default=None, max_length=8)
    kind: FranchiseeKind = "external"
    contactName: str = Field(min_length=2, max_length=255)
    contactPhone: Phone
    contactEmail: EmailStr | None = None
    admin: FranchiseeAdminIn | None = None  # optional first login (Task 08 may omit it)


class FranchiseeUpdateRequest(BaseModel):
    """Omit a field to leave it alone; `contactEmail` sent as null clears it."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    kind: FranchiseeKind | None = None
    contactName: str | None = Field(default=None, min_length=2, max_length=255)
    contactPhone: OptionalPhone = None
    contactEmail: EmailStr | None = None


class PincodesRequest(BaseModel):
    pincodeRanges: str = Field(default="", max_length=20_000)


class FranchiseeOut(AppModel):
    id: uuid.UUID
    code: str
    name: str
    kind: FranchiseeKind
    isHome: bool
    contactName: str | None
    contactPhone: str | None
    contactEmail: str | None
    isActive: bool
    #: compress(owned, universe=active master codes). "" for the home (catch-all)
    #: and for a franchisee that owns nothing yet.
    pincodeRanges: str
    #: Non-home: its rows. Home: active master codes no other franchisee owns.
    pincodeCount: int
    technicianCount: int  # profiles whose membership is not removed (suspended included)
    openInviteCount: int  # technician_invites in LIVE_INVITE_STATUSES
    adminCount: int  # active franchisee_admin memberships
    createdAt: datetime


class FranchiseeOptionOut(AppModel):
    id: uuid.UUID
    name: str
    code: str
    kind: FranchiseeKind
    isHome: bool
    isActive: bool


class RangeSetOut(AppModel):
    count: int
    ranges: str  # compress(codes, universe=…)


class PincodeClashOut(AppModel):
    pincode: str
    franchiseeId: uuid.UUID
    franchiseeName: str


class MovedTechnicianOut(AppModel):
    id: uuid.UUID
    code: str
    name: str | None
    fromFranchiseeId: uuid.UUID
    fromFranchiseeName: str
    toFranchiseeId: uuid.UUID
    toFranchiseeName: str
    pincodeCount: int


class TrimmedTechnicianOut(AppModel):
    id: uuid.UUID
    code: str
    name: str | None
    fromFranchiseeId: uuid.UUID
    fromFranchiseeName: str
    losing: list[str]  # sorted
    keepingCount: int


class RestampedTicketOut(AppModel):
    id: uuid.UUID
    code: str
    pincode: str
    fromFranchiseeName: str


class RestampedTicketsOut(AppModel):
    count: int
    sample: list[RestampedTicketOut]  # at most 20, by code


class InviteChangeOut(AppModel):
    id: uuid.UUID
    phone: str
    change: Literal["moved", "trimmed"]
    losing: list[str]  # empty when moved


class PincodeChangeOut(AppModel):
    dryRun: bool
    franchiseeId: uuid.UUID
    pincodeRanges: str  # normalised: what will be / was stored
    resolvedCount: int  # codes that exist and are active
    unknownCount: int  # span(ranges) − resolvedCount
    emptyRanges: list[str]  # entries that matched no code
    added: RangeSetOut
    removed: RangeSetOut  # handed back to home
    #: At most 50, by code — dry run only; an apply would be a 409 instead.
    clashes: list[PincodeClashOut]
    clashCount: int
    movedTechnicians: list[MovedTechnicianOut]
    trimmedTechnicians: list[TrimmedTechnicianOut]
    invitesChanged: list[InviteChangeOut]
    restampedTickets: RestampedTicketsOut
    assignedTicketsKept: int  # held tickets in those codes — informative


class FranchiseeAdminOut(AppModel):
    membershipId: uuid.UUID
    userId: uuid.UUID
    fullName: str | None
    email: str | None
    phone: str | None
    #: membership.is_active AND user.is_active.
    isActive: bool
    #: MAX(refresh_tokens.created_at) — "last active", not strictly "last
    #: sign-in" (a session refresh writes it too). Null means never.
    lastLoginAt: datetime | None
    createdAt: datetime
    # Owner ruling 2026-10-15 (R3): True when `blocks_last_admin(...)` would
    # refuse deactivating this admin (non-home franchisee, this admin active, no
    # other active admin). Lets the console disable the Deactivate action and
    # say why, instead of offering a button that answers 409. Always False on
    # the home franchisee.
    isLastActiveAdmin: bool


class FranchiseeAdminCreatedOut(FranchiseeAdminOut, EmailOutcome):
    """`POST /admins` and the reissue only."""


class FranchiseeCreatedOut(FranchiseeOut):
    """`POST /franchisees` only — carries the optional first admin login."""

    admin: FranchiseeAdminCreatedOut | None