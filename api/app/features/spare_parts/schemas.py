"""Request/response models for the spare-parts slice.

The request shape itself (`PartRequestOut`) lives in `app/core/part_request_out`
because the tickets slice returns it too, and slices never import each other.
The facility-user shapes live in `app/core/facility_users` for the same reason
(the portal slice serves the same four routes for a franchisee's own people).
"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.schemas import AppModel
from app.core.spare_parts import normalize_part_name


class SparePartOut(AppModel):
    """One catalogue row, with the level it sits on."""

    id: uuid.UUID
    name: str
    isActive: bool
    ownerKind: Literal["node", "model"]
    ownerId: uuid.UUID
    ownerName: str


class CatalogueOwnerOut(AppModel):
    kind: Literal["node", "model"]
    id: uuid.UUID
    name: str
    #: The category names ABOVE the owner, root first. For a model that is its
    #: whole node chain (*Home Appliances > Washing Machine > Front Load*).
    path: list[str]


class CatalogueOut(AppModel):
    owner: CatalogueOwnerOut
    #: This owner's OWN rows — active and inactive alike.
    own: list[SparePartOut]
    #: What it inherits from above, merged (deepest wins), active only — for a
    #: model, exactly what a technician sees minus the model's own rows, so the
    #: console can say "hidden here" about a name the model switched off.
    inherited: list[SparePartOut]


def _name(value: str) -> str:
    name = normalize_part_name(value)
    if not 1 <= len(name) <= 120:
        raise ValueError("The part name must be 1 to 120 characters")
    return name


class SparePartCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _name(value)


class SparePartUpdate(BaseModel):
    """Omit a field to leave it alone."""

    name: str | None = None
    isActive: bool | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else _name(value)


class ApproveBody(BaseModel):
    #: P7: approving an Other request offers to add its name to the ticket's
    #: category list. Ignored on a request that already names a catalogue row.
    addToCatalogue: bool = False


class RejectBody(BaseModel):
    """The one body for both rejections — from `requested` (declined) and from
    `approved` (cancelled; owner ruling 2026-10-15, R2). The reason is required
    both times: the technician hears it, and the territory staff bell quotes it."""

    reason: str = Field(min_length=1, max_length=255)

    @field_validator("reason")
    @classmethod
    def _trim(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("A reason is required")
        return reason


class IssueBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class ReturnBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    #: A blob NAME from `POST /uploads?kind=attachment`, never a URL.
    photoBlobName: str | None = Field(default=None, max_length=255)


class PartRequestCountsOut(AppModel):
    """For the rail badge: what is still on this facility's desk."""

    requested: int
    approved: int
    issued: int
