"""Vendor request/response models.

The statutory field types come from `app.core.statutory`, shared with companies —
a GSTIN is a GSTIN wherever it is typed. `phone` reuses `app.core.phone.Phone`,
which normalises to E.164 before validating (hard rule 7).
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.core.phone import Phone
from app.core.schemas import AppModel
from app.core.statutory import Address, CityState, Cin, GstNumber, Pincode

Name255 = Field(min_length=2, max_length=255)


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
    isActive: bool = True


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
    isActive: bool | None = None


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
    isActive: bool
    #: How many live product models carry this vendor as their brand. A real
    #: COUNT — it is what the delete confirmation quotes back at the user.
    modelCount: int
    createdAt: datetime


class VendorOptionOut(AppModel):
    """Just enough to draw the brand picker on the product model form."""

    id: uuid.UUID
    name: str
