"""Self-registration request/response models. All of these are unauthenticated."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.core.images import ImageUrl
from app.core.schemas import AppModel
from app.core.upi import UpiId

Pincode = Annotated[str, Field(pattern=r"^[0-9]{6}$")]


class InviteSubcategoryOut(AppModel):
    """One certifiable node — a MAIN sub-category — as a coverage-screen tile."""

    id: uuid.UUID
    #: The node's own name, bare. Every tile under a heading is a sibling of the
    #: others, so there is nothing to disambiguate. This once carried a composed
    #: breadcrumb ("TV › Android TV") because the list was flattened from every
    #: depth and two branches could each hold a "32 inch"; certification narrowed
    #: to depth 1 and the composition went with the levels that needed it.
    name: str
    iconKey: str
    isActive: bool = True


class InviteCategoryOut(AppModel):
    """A root category, with its DIRECT children as the tiles beneath it.

    Two levels on the wire, and now two levels in the catalogue's own terms as
    well: a technician certifies on a main sub-category (`CERTIFY_DEPTH`), so
    the direct children ARE the certifiable set and nothing deeper belongs here.

    It used to flatten every descendant into this list, which put six tiles
    under one heading for a single branch and asked a technician to choose
    between "Television" and "Television › Android TV" — two answers meaning
    almost the same thing, one of which quietly stops covering new work.

    The DTO has not moved through either change, and that is the point:
    `mobileapp` ships as an APK, the coverage screen draws whatever arrives, and
    narrowing the list server-side reached installed builds with no rebuild.
    """

    id: uuid.UUID
    name: str
    iconKey: str
    subcategories: list[InviteSubcategoryOut] = Field(default_factory=list)


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
    #: two on a field connection. Flattened to two levels — see
    #: `InviteCategoryOut`.
    categories: list[InviteCategoryOut]
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
    #: Where their money should go. OPTIONAL, and it must stay optional: this is
    #: the last screen of a joining flow, and refusing to create the account
    #: because somebody does not have their UPI handle to hand would strand them
    #: on a form after they have already proved their phone. Left blank, they
    #: add it later on Profile → Payout account.
    upiId: UpiId = None

