"""Ticket request/response models.

Two rules live here rather than in the service, because they are shape rules
rather than data rules — they can be decided from the request alone:

  * a Tech Visit or Service ticket must carry a description, and an
    Installation + Demo ticket must not;
  * a slot is both ends or neither.

The rule that CANNOT live here is "the service type must be one this model
supports" — that needs the model row, so it is in the service.
"""

import datetime
import uuid
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

from app.core.phone import Phone
from app.core.schemas import AppModel
from app.core.service_types import SERVICE_TYPES
from app.core.statutory import Address, CityState, Pincode
from app.core.tickets import (
    DEFAULT_SERVICE_LEVEL_HOURS,
    DESCRIPTION_REQUIRED_FOR,
    SERVICE_LEVEL_HOURS,
)

ServiceLevelHours = Annotated[int, Field(description="12, 24, 36 or 48")]
Name255 = Annotated[str, Field(min_length=2, max_length=255)]
SerialNumber = Annotated[str | None, Field(default=None, max_length=64)]
#: Long enough to be a sentence about the fault, not "broken".
Description = Annotated[str | None, Field(default=None, max_length=2000)]


class TicketCreateRequest(BaseModel):
    vendorId: uuid.UUID
    subcategoryId: uuid.UUID
    modelId: uuid.UUID
    serviceType: str
    description: Description = None
    serialNumber: SerialNumber = None

    customerName: Name255
    customerPhone: Phone
    address: Address
    city: CityState
    state: CityState
    pincode: Pincode

    expectedDate: datetime.date
    serviceLevelHours: ServiceLevelHours = DEFAULT_SERVICE_LEVEL_HOURS
    #: Omit both for a ticket whose slot has not been agreed yet — it lands as
    #: "Slot Pending" and the customer is asked to pick.
    slotStart: datetime.datetime | None = None
    slotEnd: datetime.datetime | None = None

    @model_validator(mode="after")
    def _check(self) -> "TicketCreateRequest":
        if self.serviceType not in SERVICE_TYPES:
            raise ValueError(
                f"Unknown service type: {self.serviceType}. "
                f"Choose from {', '.join(SERVICE_TYPES)}."
            )
        if self.serviceLevelHours not in SERVICE_LEVEL_HOURS:
            raise ValueError(
                "Service level must be one of "
                f"{', '.join(str(h) for h in SERVICE_LEVEL_HOURS)} hours"
            )

        text = (self.description or "").strip()
        if self.serviceType in DESCRIPTION_REQUIRED_FOR:
            if len(text) < 10:
                raise ValueError(
                    f"Describe the problem — a {self.serviceType} needs to say what "
                    "is wrong, or the technician arrives blind"
                )
        elif text:
            # Refused rather than ignored: a description silently dropped is a
            # customer's words thrown away without anybody noticing.
            raise ValueError(
                "Only a "
                f"{' or '.join(DESCRIPTION_REQUIRED_FOR)} ticket takes a "
                f"description — {self.serviceType} does not"
            )
        self.description = text or None

        if (self.slotStart is None) != (self.slotEnd is None):
            raise ValueError("A slot needs both a start and an end")
        if self.slotStart and self.slotEnd and self.slotEnd <= self.slotStart:
            raise ValueError("The slot must end after it starts")
        return self


class TicketOut(AppModel):
    id: uuid.UUID
    code: str

    vendorId: uuid.UUID
    vendorName: str
    subcategoryId: uuid.UUID
    #: The parent category name — the tree level the console groups by.
    categoryName: str
    subcategoryName: str
    modelId: uuid.UUID
    modelName: str

    serviceType: str
    description: str | None
    serialNumber: str | None

    customerName: str
    customerPhone: str
    address: str
    city: str
    state: str
    pincode: str

    expectedDate: datetime.date
    serviceLevelHours: int
    slotStart: datetime.datetime | None
    slotEnd: datetime.datetime | None
    slaDueAt: datetime.datetime
    #: Derived on every read from the slot, the due time and the status — never
    #: stored, because it changes with the clock and a stored copy would be
    #: wrong the moment nobody looked at it.
    slaState: str

    status: str
    technicianId: uuid.UUID | None
    technicianName: str | None

    #: not_needed (ops set the slot) | pending | sent | failed.
    slotRequestStatus: str
    #: Meta's own words when it refused, so ops can act rather than guess.
    slotRequestError: str | None
    #: When the CUSTOMER picked. Null when ops entered the slot themselves —
    #: which is how the console tells "they chose this" from "we did".
    slotConfirmedAt: datetime.datetime | None
    #: The scheduling link, so ops can copy it out when WhatsApp refuses and
    #: read it down the phone. Present only while the slot is still theirs to
    #: pick; it disappears the moment it is used.
    slotLink: str | None

    createdAt: datetime.datetime


class TimelineEventOut(AppModel):
    """One entry in a ticket's audit trail.

    One row of `ticket_events`, written when the thing happened. It used to be
    DERIVED from the ticket's current columns, which meant it could never say
    when anything changed — and the mock version of the same idea derived a
    seven-event trail from `status` alone, "Notified 6 eligible technicians" for
    a ticket nobody had notified. That is exactly the kind of detail people
    believe.
    """

    at: datetime.datetime
    kind: str
    title: str
    #: Null for an event nobody caused — an SLA breach has no actor.
    by: str | None = None
    note: str | None = None


class TicketDetailOut(TicketOut):
    timeline: list[TimelineEventOut] = []
