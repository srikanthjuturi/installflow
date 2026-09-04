"""Company (tenant) request/response models — superadmin console."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.phone import Phone
from app.core.schemas import AppModel, EmailOutcome

# Normalise-then-validate field types. They live in app/core/statutory.py because
# vendors need the same GSTIN and address shapes, and hard rule 4 forbids that
# slice importing this one. Re-exported here so existing readers still find them.
from app.core.statutory import (  # noqa: F401
    Address,
    CityState,
    GstNumber,
    GstStatus,
    Pan,
    Pincode,
)


class CompanyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    #: The prefix on every code this company ever mints — `RGT-INST-0001`.
    #: Omit it and the server derives one from the name; it cannot be changed
    #: afterwards, because tickets store the assembled string.
    code: str | None = Field(default=None, max_length=6)
    email: EmailStr  # becomes the admin's login email
    #: Mandatory, like a vendor's. `Phone` rather than `OptionalPhone` is what
    #: refuses the empty string a form sends for a box left blank — the whole
    #: point of the distinction between the two types.
    phone: Phone
    #: No password: the server mints a temporary one and emails it to `email`.
    adminName: str | None = Field(default=None, max_length=255)
    # Statutory identity (mandatory; the GST API will auto-fill these later).
    gstNumber: GstNumber
    pan: Pan
    gstCompanyStatus: GstStatus
    #: ONE box, `Address` like a vendor's — 500 characters, newlines kept.
    #: `addressLine2` was dropped in `e6b40d92c7a5` and folded into this.
    addressLine1: Address
    city: CityState
    state: CityState
    pincode: Pincode


class CompanyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    #: Omitted means unchanged; there is no longer a way to clear it. Same
    #: shape as `VendorUpdateRequest.phone`, and for the same reason.
    phone: Phone | None = None
    gstNumber: GstNumber | None = None
    pan: Pan | None = None
    gstCompanyStatus: GstStatus | None = None
    addressLine1: Address | None = None
    city: CityState | None = None
    state: CityState | None = None
    pincode: Pincode | None = None


class CompanyStatusRequest(BaseModel):
    isActive: bool


class CompanyOut(AppModel):
    id: uuid.UUID
    name: str
    slug: str
    code: str
    email: str
    phone: str
    isActive: bool
    gstNumber: str
    pan: str
    gstCompanyStatus: str
    addressLine1: str
    city: str
    state: str
    pincode: str
    adminEmail: str | None = None
    userCount: int | None = None
    createdAt: datetime


class CompanyCreatedOut(CompanyOut, EmailOutcome):
    """`POST /companies` only — see `UserCreatedOut` for why a subclass."""
