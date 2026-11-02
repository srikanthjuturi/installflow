"""A technician's spare-parts delivery address (Epic 6).

Read `models/technician.py` (`parts_*`) and `models/spare_part.py`
(`delivery_address`). Two halves:

  * the address a technician or their manager SAVES on the profile - validated
    here once, so the technician's own door and the two manager doors cannot
    disagree about what a good one is;
  * `snapshot_for(profile)` - the address COPIED onto a part request at raise
    time. Copied, never linked, for the reason the base location is: a parcel
    already on its way must not be redirected by an edit made afterwards.

With no parts address on file the snapshot falls back to the technician's base
pincode (a pincode only - no street), flagged `source: "base"` so the facility
can see it is a guess at the area, not a place a courier can find.
"""

import datetime
import re
import uuid

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.phone import OptionalPhone
from app.core.schemas import AppModel
from app.models.territory import Pincode

_PINCODE = re.compile(r"^[0-9]{6}$")


class PartsAddressIn(BaseModel):
    line: str = Field(min_length=3, max_length=240)
    city: str = Field(min_length=2, max_length=80)
    pincode: str
    landmark: str | None = Field(default=None, max_length=120)
    #: Who receives the parcel. Blank = the technician's own phone.
    contactPhone: OptionalPhone = None

    @field_validator("line", "city")
    @classmethod
    def _trim(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Too short")
        return v

    @field_validator("landmark")
    @classmethod
    def _blank(cls, v: str | None) -> str | None:
        return (v or "").strip() or None

    @field_validator("pincode")
    @classmethod
    def _shape(cls, v: str) -> str:
        v = v.strip()
        if not _PINCODE.match(v):
            raise ValueError("A pincode is six digits")
        return v


class PartsAddressOut(AppModel):
    line: str
    city: str
    pincode: str
    landmark: str | None
    contactPhone: str | None
    setAt: datetime.datetime | None


class DeliveryAddressOut(AppModel):
    """The copy on a part request."""

    line: str | None
    city: str | None
    pincode: str
    landmark: str | None
    contactPhone: str | None
    #: `parts_address` - a real address; `base` - only the technician's base
    #: pincode was on file.
    source: str


def out_of(profile) -> PartsAddressOut | None:
    if profile.parts_address_line is None:
        return None
    return PartsAddressOut(
        line=profile.parts_address_line,
        city=profile.parts_city,
        pincode=profile.parts_pincode,
        landmark=profile.parts_landmark,
        contactPhone=profile.parts_contact_phone,
        setAt=profile.parts_address_set_at,
    )


async def apply(
    db: AsyncSession,
    profile,
    body: PartsAddressIn,
    *,
    by_user_id: uuid.UUID,
    now: datetime.datetime,
) -> None:
    """Validate against the geography master and write onto the profile.

    The pincode must exist and be on - the same rule intake applies to a
    ticket - because a parcel to a code India Post does not know is lost money.
    It does NOT have to be inside the franchisee: a technician may live outside
    the area they serve.
    """
    live = await db.scalar(
        select(Pincode.code).where(Pincode.code == body.pincode, Pincode.is_active.is_(True))
    )
    if live is None:
        raise AppError(422, "UNKNOWN_PINCODE", f"{body.pincode} is not a pincode we know")
    profile.parts_address_line = body.line
    profile.parts_city = body.city
    profile.parts_pincode = body.pincode
    profile.parts_landmark = body.landmark
    profile.parts_contact_phone = body.contactPhone
    profile.parts_address_set_at = now
    profile.parts_address_set_by_user_id = by_user_id


def clear(profile, *, by_user_id: uuid.UUID, now: datetime.datetime) -> None:
    profile.parts_address_line = None
    profile.parts_city = None
    profile.parts_pincode = None
    profile.parts_landmark = None
    profile.parts_contact_phone = None
    profile.parts_address_set_at = now
    profile.parts_address_set_by_user_id = by_user_id


def snapshot_for(profile, *, technician_phone: str | None = None) -> dict | None:
    """What to copy onto a new part request, or None when nothing is on file."""
    if profile.parts_address_line is not None:
        return {
            "line": profile.parts_address_line,
            "city": profile.parts_city,
            "pincode": profile.parts_pincode,
            "landmark": profile.parts_landmark,
            "contactPhone": profile.parts_contact_phone or technician_phone,
            "source": "parts_address",
        }
    if profile.base_pincode:
        return {
            "line": None,
            "city": None,
            "pincode": profile.base_pincode,
            "landmark": None,
            "contactPhone": technician_phone,
            "source": "base",
        }
    return None


def delivery_out(raw: dict | None) -> DeliveryAddressOut | None:
    """The stored JSON back to the wire - tolerant of anything hand-patched."""
    if not isinstance(raw, dict) or not isinstance(raw.get("pincode"), str):
        return None
    source = raw.get("source")
    return DeliveryAddressOut(
        line=raw.get("line") if isinstance(raw.get("line"), str) else None,
        city=raw.get("city") if isinstance(raw.get("city"), str) else None,
        pincode=raw["pincode"],
        landmark=raw.get("landmark") if isinstance(raw.get("landmark"), str) else None,
        contactPhone=raw.get("contactPhone") if isinstance(raw.get("contactPhone"), str) else None,
        source=source if source in ("parts_address", "base") else "parts_address",
    )
