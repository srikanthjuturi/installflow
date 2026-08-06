"""Company (tenant) request/response models — superadmin console."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, EmailStr, Field

from app.core.schemas import AppModel


def _upper(v: object) -> object:
    return v.strip().upper() if isinstance(v, str) else v


def _strip(v: object) -> object:
    return v.strip() if isinstance(v, str) else v


# Reusable validated field types: normalize (strip/upper) first, then pattern-check.
GstNumber = Annotated[
    str,
    BeforeValidator(_upper),
    Field(pattern=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"),
]
Pan = Annotated[str, BeforeValidator(_upper), Field(pattern=r"^[A-Z]{5}[0-9]{4}[A-Z]$")]
Pincode = Annotated[str, BeforeValidator(_strip), Field(pattern=r"^[0-9]{6}$")]
GstStatus = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=64)]
AddrLine = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=255)]
AddrLineOpt = Annotated[str, BeforeValidator(_strip), Field(max_length=255)]
CityState = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=120)]


class CompanyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
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
