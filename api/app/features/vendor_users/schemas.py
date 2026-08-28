"""Request/response models for a vendor's own people."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field

from app.core.phone import Phone
from app.core.schemas import AppModel, EmailOutcome

Name255 = Annotated[str, Field(min_length=2, max_length=255)]


class VendorUserCreateRequest(BaseModel):
    """No `role`, no territory and no password.

    The role is fixed — a vendor creates vendor users and nothing else — and a
    vendor has no regions or pincodes to hand out. Both are absent rather than
    optional-and-ignored, so there is no field a caller could set and be quietly
    disappointed by. The password is the server's: it mints a temporary one and
    emails it, so there is nothing for the vendor to invent or pass along.
    """

    fullName: Name255
    email: EmailStr
    #: Optional, unlike a technician's. A vendor's people are reached by email;
    #: the phone is for whoever ends up calling them about a job.
    phone: Phone | None = None


class VendorUserUpdateRequest(BaseModel):
    """Omit a field to leave it alone.

    Neither the email nor the password is here. The email is the identity the
    account is looked up by, and the password is the holder's own — a vendor
    handing out a new one behind their back is a different feature with
    different consequences.
    """

    fullName: str | None = Field(default=None, min_length=2, max_length=255)
    phone: Phone | None = None
    isActive: bool | None = None


class VendorUserOut(AppModel):
    #: The MEMBERSHIP id, not the user id — it is what the routes take, because
    #: removing somebody removes them from this vendor, not from the platform.
    membershipId: uuid.UUID
    userId: uuid.UUID
    fullName: str | None
    email: str | None
    phone: str | None
    isActive: bool
    #: True for the account that IS the vendor, false for the people it created.
    #: The vendor's own row is listed so the screen is not mysteriously missing
    #: whoever is looking at it, and it cannot be edited or removed from here.
    isOwner: bool
    createdAt: datetime


class VendorUserCreatedOut(VendorUserOut, EmailOutcome):
    """`POST /vendor/users` only — see `UserCreatedOut` for why it subclasses."""
