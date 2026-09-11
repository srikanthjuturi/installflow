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
from app.core.schemas import AppModel, EmailOutcome
from app.models.vendor_brand import MAX_BRAND_NAME
from app.core.statutory import (
    Address,
    CityState,
    Cin,
    GstNumber,
    GstStatus,
    Pan,
    Pincode,
)

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


#: The most brands one vendor may carry. A distributor with forty labels is a
#: master-data import, not a form; the bound is here to keep the form a form.
MAX_BRANDS = 20


def _clean_brand_name(value: str) -> str:
    """One brand name, with runs of whitespace collapsed — "Sun  view " is "Sun view"."""
    cleaned = " ".join(value.split())
    if len(cleaned) < 2:
        raise ValueError("A brand name needs at least 2 characters")
    if len(cleaned) > MAX_BRAND_NAME:
        raise ValueError(f"Keep a brand name under {MAX_BRAND_NAME} characters")
    return cleaned


#: One brand name as typed. Cleaned here so every writer stores the same shape,
#: and so "Sunview" and "sunview " are caught as the same brand before the
#: unique index has to be the one to say so.
BrandName = Annotated[str, AfterValidator(_clean_brand_name)]


def _check_unique_names(names: list[str]) -> list[str]:
    lowered = [n.lower() for n in names]
    if len(set(lowered)) != len(lowered):
        raise ValueError("Each brand can be listed only once")
    return names


#: The brands entered on the staff form when a vendor is ADDED.
BrandNames = Annotated[
    list[BrandName],
    Field(max_length=MAX_BRANDS),
    AfterValidator(_check_unique_names),
]


class VendorBrandIn(BaseModel):
    """One row of the brand list on the staff form's EDIT.

    With an `id` it is a brand the vendor already has (renamed if the name
    changed); without one it is a new brand. A row that disappears from the list
    is removed — see `service._apply_brands` for the rules that guard that.
    """

    id: uuid.UUID | None = None
    name: BrandName


def _check_unique_rows(rows: list[VendorBrandIn]) -> list[VendorBrandIn]:
    _check_unique_names([r.name for r in rows])
    return rows


VendorBrandRows = Annotated[
    list[VendorBrandIn],
    Field(min_length=1, max_length=MAX_BRANDS),
    AfterValidator(_check_unique_rows),
]


class OwnBrandRequest(BaseModel):
    """A vendor naming a brand from its portal. It waits for approval."""

    name: BrandName


class VendorCreateRequest(BaseModel):
    name: str = Name255
    gstNumber: GstNumber
    #: The holder's PAN — characters 3-12 of `gstNumber`, which is why the
    #: console can fill it without asking anybody.
    #:
    #: Optional here, unlike on a company, because the two clients that predate
    #: the column send nothing. Omitting it stores NULL rather than deriving one:
    #: the slice belongs where a person can see the result and correct it, not in
    #: a service quietly writing a value nobody typed.
    pan: Pan | None = None
    #: The registration's standing at the GST portal. Nothing fills this until
    #: the GSTIN lookup exists, and NULL honestly says "never looked up".
    gstCompanyStatus: GstStatus | None = None
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
    #: Whether the portal offers this vendor the address search on the ticket
    #: form. Defaults ON, unlike a metered capability's usual instinct, because
    #: off costs more than money: only a picked search result puts coordinates
    #: on a ticket, and without them a technician's live photo is verified by
    #: pincode instead of by distance. See the column comment on the model.
    addressSearchEnabled: bool = True
    #: Whether a technician's live site photo is location-gated on this vendor's
    #: jobs. Defaults ON. Off never stops the photo carrying a location — it
    #: stops the server refusing one. See the column comment on the model.
    locationCheckEnabled: bool = True

    #: The vendor's login. REQUIRED, because only a vendor can raise a ticket —
    #: a vendor without an account would be a brand nobody could ever raise one
    #: against, which is a dead end rather than a choice.
    #:
    #: No password: the server mints a temporary one and emails it here.
    loginEmail: EmailStr

    #: The brands this vendor sells, approved as they are written — the people
    #: adding the vendor are the people who would approve them.
    #:
    #: Optional on the wire, and EMPTY means "it sells under its own name": one
    #: brand called what the vendor is called, exactly what the migration gave
    #: every vendor that existed before brands did. That keeps an older console
    #: that has never heard of this field adding vendors that work.
    brands: BrandNames = Field(default_factory=list)


class VendorUpdateRequest(BaseModel):
    """Omit a field to leave it alone.

    `cin`, `pan` and `gstCompanyStatus` are the fields that can be CLEARED, so
    the service tests presence in `model_fields_set` rather than truthiness — an
    explicit null has to mean "remove it", which an `is not None` test would read
    as "leave it alone".
    """

    name: str | None = Field(default=None, min_length=2, max_length=255)
    gstNumber: GstNumber | None = None
    pan: Pan | None = None
    gstCompanyStatus: GstStatus | None = None
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
    addressSearchEnabled: bool | None = None
    locationCheckEnabled: bool | None = None
    #: The whole brand list, or omit it to leave the brands alone. Rows with an
    #: `id` are kept (renamed if the name changed), rows without one are new and
    #: approved, and an APPROVED brand missing from the list is removed — refused
    #: while a live product still carries it. A vendor's pending or rejected
    #: brands are decided on Approvals, never here, so leaving them out of this
    #: list does nothing to them.
    brands: VendorBrandRows | None = None
    #: NB: no password. Reissuing one is now `POST /vendors/{id}/reissue-password`
    #: — it takes no body, because the password is the server's to choose.
    #:
    #: The login EMAIL is deliberately not editable either: it is the identity
    #: the account is looked up by, and moving it would silently strand the
    #: vendor on credentials nobody has recorded.


class VendorBrandOut(AppModel):
    """One of a vendor's brands, as staff and the vendor itself see it."""

    id: uuid.UUID
    name: str
    #: `pending` | `approved` | `rejected`. Only an approved brand can be put
    #: on a product.
    approvalStatus: str
    #: Why it was refused, when it was. The vendor reads this.
    rejectionReason: str | None = None
    submittedAt: datetime | None = None
    #: Live products carrying it — what a removal is refused over.
    productCount: int = 0


class VendorOut(AppModel):
    id: uuid.UUID
    name: str
    gstNumber: str
    #: NULL only where nobody has filled it in — a PAN is derivable from the
    #: GSTIN of every vendor, so it never means "this one has none".
    pan: str | None = None
    #: NULL means the GST portal has never been asked. The console renders that
    #: as nothing, not as "Active".
    gstCompanyStatus: str | None = None
    cin: str | None
    contactPerson: str
    phone: str
    address: str
    city: str
    state: str
    pincode: str
    intakeChannels: list[str]
    isActive: bool
    addressSearchEnabled: bool
    locationCheckEnabled: bool
    #: How many address searches this vendor and their staff have run, ever.
    #:
    #: A real COUNT over `vendor_address_searches`, one row per billed Google
    #: session — never a stored counter. LIFETIME and unbounded: there is no
    #: date filter, and the index behind it carries no `created_at`, so a
    #: "this month" figure needs that column added before it needs a query.
    #:
    #: It does not move when the switch does. Turning a vendor off is a decision
    #: about tomorrow, not a way to erase what they already spent.
    addressSearchCount: int = 0
    #: How many live product models this vendor supplies, across its brands. A
    #: real COUNT — it is what the delete confirmation quotes back at the user.
    modelCount: int
    #: Every live brand, approved first then waiting, alphabetical within each.
    brands: list[VendorBrandOut] = []
    #: Live tickets raised by this vendor. A real COUNT since vendors started
    #: raising their own — it was hard-coded 0 while nothing could receive one.
    ticketCount: int = 0
    #: The address this vendor signs in with. Null only for a vendor created
    #: before logins existed, which is nothing outside a half-migrated database.
    loginEmail: str | None = None
    createdAt: datetime


class VendorCreatedOut(VendorOut, EmailOutcome):
    """`POST /vendors` and the reissue — see `UserCreatedOut` for why a subclass."""


class AddressSearchRequest(BaseModel):
    """The portal reporting one Google autocomplete session.

    `sessionId` is the CLIENT's uuid for that session, and it is the whole
    idempotency story: the UNIQUE on `(company_id, search_session_id)` plus
    `ON CONFLICT DO NOTHING` means a retried request, a double-fired debounce or
    a replay after a token refresh all land on the row already there.

    There is deliberately no vendor id. It comes from the principal, like
    everything else a vendor may call — hard rule 0.
    """

    sessionId: uuid.UUID


class VendorBrandOptionOut(AppModel):
    id: uuid.UUID
    name: str


class VendorOptionOut(AppModel):
    """Just enough to draw the product form's Vendor and Brand pickers."""

    id: uuid.UUID
    name: str
    #: APPROVED brands only — the ones a product may be put under. A vendor's
    #: pending brand is not offered until somebody approves it.
    brands: list[VendorBrandOptionOut] = []


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
