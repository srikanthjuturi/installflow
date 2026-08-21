"""Self-registration request/response models. All of these are unauthenticated."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.core.images import ImageUrl
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
    regionId: uuid.UUID
    #: What the manager pre-set, if anything. Null means no limit — the app
    #: does not ask for one while joining, so this is usually null.
    dailyJobCap: int | None
    #: The catalogue, bundled so the coverage screen needs one call rather than
    #: two on a field connection.
    categories: list[ProductCategoryOut]
    #: The coverage the manager assigned. The app SHOWS this and does not
    #: offer to change it — see `TechnicianInvitePincode`.
    pincodes: list[str] = Field(default_factory=list)


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
    profileImageUrl: ImageUrl = None
    subcategoryIds: list[uuid.UUID] = Field(min_length=1)
    # No `pincodes`: coverage comes from the invite, decided by the manager.
    #: **Not collected while joining.** Registering is about who you are and
    #: where you work; a technician sets their own cap afterwards, in the app's
    #: Availability screen. Kept accepted (and unbounded above) so a client that
    #: does offer it is not refused, and null keeps whatever the invite held.
    dailyJobCap: int | None = Field(default=None, ge=1)

