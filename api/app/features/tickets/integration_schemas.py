"""Wire shapes for the vendor CRM ticket API.

The request is read by hand in the router (not by FastAPI's body binding) so a bad
one answers in the CRM API's own envelope, with the stable `VALIDATION_ERROR`
code and one line per field. It IGNORES fields it does not know: a CRM that still
sends a franchisee, a price, a vendor, a company or a service-level window has
those dropped, never used — the pincode decides the franchisee, the product the
price, and every API ticket gets the standard service level.
"""

import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.coordinates import IndiaLatitude, IndiaLongitude
from app.core.phone import OptionalPhone, Phone
from app.core.schemas import AppModel
from app.core.statutory import Address, CityState, Pincode

Reference = Annotated[str, Field(min_length=1, max_length=64)]
Sku = Annotated[str, Field(min_length=1, max_length=64)]


class IntegrationTicketCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    #: The CRM's own number for this job. Unique per vendor for ever.
    reference: Reference
    customerName: Annotated[str, Field(min_length=2, max_length=255)]
    customerPhone: Phone
    customerAltPhone: OptionalPhone = None
    address: Address
    city: CityState
    state: CityState
    pincode: Pincode
    #: The VENDOR'S OWN code for the product.
    sku: Sku
    serialNumber: Annotated[str, Field(min_length=1, max_length=64)]
    serviceType: str
    #: Required for a Tech Visit or a Service, and not allowed for the other
    #: types — the same rule a hand-typed ticket has.
    description: Annotated[str | None, Field(default=None, max_length=2000)] = None
    expectedDate: datetime.date

    locality: Annotated[str | None, Field(default=None, max_length=80)] = None
    latitude: IndiaLatitude = None
    longitude: IndiaLongitude = None
    #: A fixed visit time. Both or neither; without them the customer is asked
    #: to pick one.
    visitStart: datetime.datetime | None = None
    visitEnd: datetime.datetime | None = None
    isHighPriority: bool = False
    extraAmountPaise: Annotated[int | None, Field(default=None, gt=0, le=10_000_000)] = None
    extraAmountNote: Annotated[str | None, Field(default=None, max_length=120)] = None
    purchaseMode: Literal["online", "offline"] = "offline"
    purchasePlatformName: Annotated[str | None, Field(default=None, max_length=120)] = None
    #: Run every rule and answer, but create, charge and send nothing.
    checkOnly: bool = False

    @model_validator(mode="after")
    def _pairs(self) -> "IntegrationTicketCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be sent together")
        if (self.visitStart is None) != (self.visitEnd is None):
            raise ValueError("visitStart and visitEnd must be sent together")
        return self


class IntegrationTicketReply(AppModel):
    #: Our ticket code. Null for a check-only call, which makes no ticket.
    ticketNumber: str | None = None
    reference: str
    status: str | None = None
    #: Deliberately NO franchisee: the vendor portal withholds it from a vendor
    #: (who runs the company's technicians is not the vendor's business, the same
    #: rule that hides the payout), and a CRM acts for the vendor.
    #: True when `reference` already belonged to a ticket and that one was returned.
    repeat: bool = False
    checkOnly: bool = False
    #: Check-only calls only: every rule passed and a real call would create it.
    wouldCreate: bool | None = None


# ── what the CRM may read back ───────────────────────────────────────────────


class IntegrationVisit(AppModel):
    start: datetime.datetime
    end: datetime.datetime
    #: True when the customer picked the time themselves; false when it was agreed
    #: by phone or fixed when the ticket was raised.
    chosenByCustomer: bool


class IntegrationTechnician(AppModel):
    #: The name ONLY. A technician's phone is never part of this view.
    name: str


class IntegrationFeedback(AppModel):
    #: Null when the customer confirmed without rating.
    rating: int | None = None
    comment: str | None = None


class IntegrationTimelineItem(AppModel):
    kind: str
    #: A fixed plain title per kind. The event's own note is never sent.
    title: str
    at: datetime.datetime


class IntegrationTicketView(AppModel):
    ticketNumber: str
    reference: str | None = None
    status: str
    visit: IntegrationVisit | None = None
    technician: IntegrationTechnician | None = None
    feedback: IntegrationFeedback | None = None
    timeline: list[IntegrationTimelineItem] | None = None
    updatedAt: datetime.datetime


class IntegrationTicketPage(AppModel):
    items: list[IntegrationTicketView]
    nextCursor: str | None = None
