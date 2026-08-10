"""Self-registration request/response models. All of these are unauthenticated."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.core.schemas import AppModel
from app.features.masters.schemas import ProductCategoryOut

Pincode = Annotated[str, Field(pattern=r"^[0-9]{6}$")]


class InviteResolveOut(AppModel):
    """What the invite screen shows before the technician has proved anything.

    Deliberately thin: a forwarded link should not disclose more than the phone
    number it was sent to, which its holder already has.
    """

    phone: str
    companyName: str
    regionName: str
    invitedByName: str | None
    expiresAt: datetime
    dailyJobCap: int
    #: The catalogue, bundled so the coverage screen needs one call rather than
    #: two on a field connection.
    categories: list[ProductCategoryOut]
    #: When an area manager sent the invite, the only pincodes this technician
    #: may claim. Null means unrestricted. Sent so the app can offer a picker
    #: instead of letting them type something that will be refused.
    allowedPincodes: list[str] | None


class OtpVerifyInviteRequest(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class RegistrationTokenOut(AppModel):
    registrationToken: str
    expiresAt: datetime


class SelfRegisterRequest(BaseModel):
    """What the technician supplies about themselves.

    Phone is NOT accepted — it comes from the invite row, or the invited number
    and the registered number could differ.
    """

    fullName: str = Field(min_length=2, max_length=255)
    profileImageUrl: str | None = None
    subcategoryIds: list[uuid.UUID] = Field(min_length=1)
    pincodes: list[Pincode] = Field(min_length=1, max_length=50)
    #: Falls back to whatever the manager pre-set on the invite.
    dailyJobCap: int | None = Field(default=None, ge=1, le=12)
