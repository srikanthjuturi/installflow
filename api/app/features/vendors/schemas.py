"""Vendor request/response models.

The statutory field types come from `app.core.statutory`, shared with companies —
a GSTIN is a GSTIN wherever it is typed. `phone` reuses `app.core.phone.Phone`,
which normalises to E.164 before validating (hard rule 7).
"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from app.core.intake import (
    AVAILABLE_INTAKE_CHANNELS,
    DEFAULT_INTAKE_CHANNELS,
    INTAKE_CHANNELS,
    UNAVAILABLE_REASON,
)
from app.core.phone import Phone
from app.core.schemas import AppModel
from app.core.statutory import Address, CityState, Cin, GstNumber, Pincode

Name255 = Field(min_length=2, max_length=255)


def _check_channels(values: list[str]) -> list[str]:
    """Clean and bound the intake channel list.

    Order is the user's and is preserved. Two separate refusals, deliberately:
    an unknown word is a malformed request, while a known-but-not-yet-available
    one is a real channel the platform cannot honour yet — and the caller
    deserves to be told which of those happened.

    The availability check is the point of hard rule 2. Greying the option out
    in the console is presentation; a hand-written request has to be refused
    here too, or "not available" means nothing.
    """
    channels = list(dict.fromkeys(v.strip() for v in values if v and v.strip()))
    if not channels:
        raise ValueError("Pick at least one intake channel")

    unknown = [c for c in channels if c not in INTAKE_CHANNELS]
    if unknown:
        raise ValueError(
            f"Unknown intake channel: {', '.join(unknown)}. "
            f"Choose from {', '.join(INTAKE_CHANNELS)}."
        )

    blocked = [c for c in channels if c not in AVAILABLE_INTAKE_CHANNELS]
    if blocked:
        reason = UNAVAILABLE_REASON.get(blocked[0], "")
        raise ValueError(
            f"{', '.join(blocked)} intake is not available yet. {reason} "
            f"Choose from {', '.join(AVAILABLE_INTAKE_CHANNELS)}."
        )
    return channels


IntakeChannels = Annotated[list[str], AfterValidator(_check_channels)]


class VendorCreateRequest(BaseModel):
    name: str = Name255
    gstNumber: GstNumber
    #: Optional: only an MCA-registered company has one.
    cin: Cin | None = None
    contactPerson: str = Name255
    phone: Phone
    address: Address
    city: CityState
    state: CityState
    pincode: Pincode
    #: How this vendor's tickets reach us. Defaults to Manual, the one that is
    #: always true — somebody can always type a ticket in.
    intakeChannels: IntakeChannels = Field(
        default_factory=lambda: list(DEFAULT_INTAKE_CHANNELS)
    )
    isActive: bool = True

    #: The vendor's login. REQUIRED, because only a vendor can raise a ticket —
    #: a vendor without an account would be a brand nobody could ever raise one
    #: against, which is a dead end rather than a choice.
    loginEmail: EmailStr
    password: str = Field(min_length=8, max_length=128)


class VendorUpdateRequest(BaseModel):
    """Omit a field to leave it alone.

    `cin` is the one field that can be CLEARED, so the service tests presence in
    `model_fields_set` rather than truthiness — an explicit null has to mean
    "remove it", which an `is not None` test would read as "leave it alone".
    """

    name: str | None = Field(default=None, min_length=2, max_length=255)
    gstNumber: GstNumber | None = None
    cin: Cin | None = None
    contactPerson: str | None = Field(default=None, min_length=2, max_length=255)
    phone: Phone | None = None
    address: Address | None = None
    city: CityState | None = None
    state: CityState | None = None
    pincode: Pincode | None = None
    #: Sent whole, never patched entry by entry — omitting it leaves the
    #: channels alone, and an empty list is refused rather than clearing them.
    intakeChannels: IntakeChannels | None = None
    isActive: bool | None = None
    #: Reissue the vendor's password. Omit to leave it alone — this is the only
    #: way back in for a vendor who has forgotten theirs, since changing a
    #: password otherwise requires knowing the current one.
    #:
    #: The login EMAIL is deliberately not editable: it is the identity the
    #: account is looked up by, and moving it would silently strand the vendor
    #: on credentials nobody has recorded.
    password: str | None = Field(default=None, min_length=8, max_length=128)


class VendorOut(AppModel):
    id: uuid.UUID
    name: str
    gstNumber: str
    cin: str | None
    contactPerson: str
    phone: str
    address: str
    city: str
    state: str
    pincode: str
    intakeChannels: list[str]
    isActive: bool
    #: How many live product models carry this vendor as their brand. A real
    #: COUNT — it is what the delete confirmation quotes back at the user.
    modelCount: int
    #: Live tickets raised by this vendor. A real COUNT since vendors started
    #: raising their own — it was hard-coded 0 while nothing could receive one.
    ticketCount: int = 0
    #: The address this vendor signs in with. Null only for a vendor created
    #: before logins existed, which is nothing outside a half-migrated database.
    loginEmail: str | None = None
    createdAt: datetime


class VendorOptionOut(AppModel):
    """Just enough to draw the brand picker on the product model form."""

    id: uuid.UUID
    name: str


class IntakeChannelOut(AppModel):
    """One row of the intake-channel catalogue.

    Served rather than mirrored so the console renders one "coming soon" reason
    instead of inventing its own, and cannot offer a channel the API would
    refuse — the same reasoning as `GET /masters/icons`.
    """

    value: str
    description: str
    available: bool
    #: Why not, when `available` is false. Null otherwise.
    unavailableReason: str | None = None
