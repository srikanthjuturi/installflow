"""Company (tenant) request/response models — superadmin console."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.schemas import AppModel

# Normalise-then-validate field types. They live in app/core/statutory.py because
# vendors need the same GSTIN and address shapes, and hard rule 4 forbids that
# slice importing this one. Re-exported here so existing readers still find them.
from app.core.statutory import (  # noqa: F401
    AddrLine,
    AddrLineOpt,
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
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    adminName: str | None = Field(default=None, max_length=255)
    # Statutory identity (mandatory; the GST API will auto-fill these later).
    gstNumber: GstNumber
    pan: Pan
    gstCompanyStatus: GstStatus
    addressLine1: AddrLine
    addressLine2: AddrLineOpt | None = None
    city: CityState
    state: CityState
    pincode: Pincode


class CompanyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    gstNumber: GstNumber | None = None
    pan: Pan | None = None
    gstCompanyStatus: GstStatus | None = None
    addressLine1: AddrLine | None = None
    addressLine2: AddrLineOpt | None = None
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
    phone: str | None
    isActive: bool
    gstNumber: str
    pan: str
    gstCompanyStatus: str
    addressLine1: str
    addressLine2: str | None
    city: str
    state: str
    pincode: str
    adminEmail: str | None = None
    userCount: int | None = None
    createdAt: datetime
