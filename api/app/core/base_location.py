"""Where a technician starts from — the base location's validation and write.

Task 10. Shared logic for the four base-location endpoints: the technicians
slice's own router (`/technicians/me/base-location` and the staff
`/technicians/{id}/base-location`), Task 05's `/franchise` twin
(`franchise_router.py`), and the session payload `auth/otp_service` builds.
Core, not a slice, for hard rule 4 — three callers, one rule.

W8: a technician may set a `pincode`, `gps` or `map` base; a manager may set
`pincode`, `map` or `manual` — `manual` means "the manager knows the spot",
which a self-report is not, and `gps` means "my device fix", which a manager
is the one person who cannot honestly offer.

R9 (owner ruling 2026-10-15): no approval flow and no cooldown. A base is
correctable at any time by the one who may set it, and what restrains abuse is
VISIBILITY (the source chip and the "set by" line) plus the frozen
`maxPaisePerJob` cap — not friction. A correction never touches an already
stamped `accept_snapshot`; the frozen basePoint keeps every paid job's record.

W7: the coordinates are COPIED onto the profile even for a pincode base, so the
point is self-contained and a later correction of that pincode's centre never
moves anybody who already has a base.
"""

import datetime
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.coordinates import INDIA_LAT, INDIA_LON, Latitude, Longitude
from app.core.errors import AppError
from app.core.franchise import franchisee_pincodes_subquery
from app.core.statutory import Pincode as PincodeStr
from app.models.franchisee import Franchisee
from app.models.territory import Pincode

#: W8 — who may send which source. The body's `source` is required with a
#: point and implied ("pincode") when a pincode is sent.
TECHNICIAN_SOURCES = ("pincode", "gps", "map")
MANAGER_SOURCES = ("pincode", "map", "manual")


class BaseLocationIn(BaseModel):
    """Exactly one of: a pincode, or a point with its source."""

    model_config = ConfigDict(from_attributes=True)

    pincode: PincodeStr | None = None
    # GLOBE bounds here — India is checked in the service (`check_in_india`),
    # so an out-of-country base carries its own error code (W11) rather than
    # reading as a malformed request.
    latitude: Latitude = None
    longitude: Longitude = None
    source: Literal["gps", "map", "manual"] | None = None

    @model_validator(mode="after")
    def _one_of_pincode_or_point(self):
        strays = any(
            v is not None for v in (self.latitude, self.longitude, self.source)
        )
        pincode_only = self.pincode is not None and not strays
        point = (
            self.latitude is not None
            and self.longitude is not None
            and self.source is not None
        )
        # Exactly one of the two — a bare pincode, or a COMPLETE point
        # (latitude + longitude + source). Both, neither, a pincode with any
        # stray piece of a point beside it, and a half-pair all 422. The
        # pincode's own shape was already validated by the `PincodeStr` bound.
        if not (pincode_only or point):
            raise ValueError(
                "Send a pincode, or a location with its source — not both."
            )
        return self


class BaseLocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    latitude: float
    longitude: float
    pincode: str | None
    source: str                                     # pincode | gps | map | manual
    setAt: datetime.datetime
    #: True when the technician set it themselves.
    setBySelf: bool
    #: Owner ruling 2026-10-15 (R9): who set it, SHOWN to the franchisee admin
    #: and home managers so a self-set base is visible, not hidden. Null when
    #: the user was since deleted (FK SET NULL).
    setByName: str | None            # the user's full name (the technician's own when setBySelf)
    setByRole: str | None            # role label: "Technician" | "Franchisee Admin" | "Area Manager" ...


class BaseFix(BaseModel):
    """What `resolve_base` certified, and `apply_base` copies onto the profile."""

    model_config = ConfigDict(frozen=True)

    latitude: float
    longitude: float
    pincode: str | None
    source: str


def check_in_india(lat: float, lng: float) -> None:          # pure → BASE_OUTSIDE_INDIA
    """The India box every other coordinate pair in this codebase keeps.

    400, not 422, on purpose (W11): the shape of the request is fine, the
    PLACE is what is wrong, and a client reading `code` translates it.
    """
    if not (INDIA_LAT[0] <= lat <= INDIA_LAT[1]):
        raise AppError(
            status_code=400,
            code="BASE_OUTSIDE_INDIA",
            detail="That location is outside India. Check the pin and try again.",
        )
    if not (INDIA_LON[0] <= lng <= INDIA_LON[1]):
        raise AppError(
            status_code=400,
            code="BASE_OUTSIDE_INDIA",
            detail="That location is outside India. Check the pin and try again.",
        )


def check_source_allowed(body, allowed: tuple[str, ...]) -> None:   # pure → 422
    """`gps` is a device fix, `manual` is an office's knowledge, and the caller
    may offer only the ones that make sense for who is sending. 422: the shape
    of the request, not its place, is what is wrong."""
    source = _body_source(body)
    if source not in allowed:
        raise AppError(
            status_code=422,
            code="SOURCE_NOT_ALLOWED",
            detail="You cannot set a base from that source.",
        )


def _body_source(body) -> str | None:
    """The source a base will be recorded with: the body's own for a point,
    `pincode` where the pincode is the thing being copied."""
    if body.pincode:
        return "pincode"
    return body.source


async def resolve_base(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID, body, allowed
) -> BaseFix:
    """Certify a base: pincode → owned AND located; point → inside India.

    pincode: must be inside `franchisee_pincodes_subquery(company_id,
    franchisee_id, is_home=…)` (Task 01; home = active master codes nobody else
    owns) — for EVERYBODY, home technician included (W9), else 422
    `PINCODE_OUTSIDE_FRANCHISEE`; and the code must have a centre
    (`pincodes.latitude` is null for ~300 of them — G2), else 400
    `PINCODE_HAS_NO_LOCATION`.
    """
    check_source_allowed(body, allowed)
    if body.pincode:
        code = body.pincode.strip()
        is_home = await db.scalar(
            select(Franchisee.is_home).where(
                Franchisee.company_id == company_id,
                Franchisee.id == franchisee_id,
                Franchisee.deleted_at.is_(None),
            )
        )
        owned = franchisee_pincodes_subquery(
            company_id, franchisee_id, is_home=bool(is_home)
        )
        row = (
            await db.execute(
                select(Pincode.latitude, Pincode.longitude)
                .where(
                    Pincode.code == code,
                    # W9: an in-range pincode is the RANGE test — the subquery IS
                    # the answer for home and non-home alike. `IN`, not a join on
                    # a column name: its one column is `code` for home and
                    # `pincode` for everybody else.
                    Pincode.code.in_(owned),
                )
            )
        ).one_or_none()
        if row is None:
            # Unknown, inactive (home range) or another franchisee's code — one
            # refusal, never a map of what exists (hard rule 1).
            raise AppError(
                status_code=422,
                code="PINCODE_OUTSIDE_FRANCHISEE",
                detail=(
                    "That pincode is outside your service area. Drop a pin on "
                    "the map or use your current location instead."
                ),
            )
        lat, lng = row
        if lat is None or lng is None:
            raise AppError(
                status_code=400,
                code="PINCODE_HAS_NO_LOCATION",
                detail=(
                    "We don't have a map location for that pincode yet. Drop a "
                    "pin on the map or use your current location instead."
                ),
            )
        return BaseFix(latitude=lat, longitude=lng, pincode=code, source="pincode")

    check_in_india(body.latitude, body.longitude)
    return BaseFix(
        latitude=body.latitude, longitude=body.longitude,
        pincode=None, source=body.source,
    )


def apply_base(profile, fix: BaseFix, *, by_user_id: uuid.UUID | None,
               now: datetime.datetime) -> None:
    """Write the six columns. Flushes nothing — the caller commits."""
    profile.base_latitude = fix.latitude
    profile.base_longitude = fix.longitude
    profile.base_pincode = fix.pincode
    profile.base_source = fix.source
    profile.base_set_at = now
    profile.base_set_by_user_id = by_user_id


async def setter_label(
    db: AsyncSession, base_set_by_user_id: uuid.UUID | None
) -> tuple[str | None, str | None]:
    """(name, role label) of who set a base, one lookup — R9's visibility.

    The role is read from a membership of theirs (they may hold only one
    membership in this company's users table per role — the practical truth:
    a technician's own membership, an admin's, a manager's). Nulls when the
    user is gone: FK SET NULL is exactly this case, and the line renders blank.
    """
    from app.models.membership import Membership
    from app.models.role import ROLE_LABELS
    from app.models.user import User

    if base_set_by_user_id is None:
        return None, None
    row = (
        await db.execute(
            select(User.full_name, User.role)
            .outerjoin(Membership, Membership.user_id == User.id)
            .where(User.id == base_set_by_user_id)
            .limit(1)
        )
    ).first()
    if row is None:
        return None, None
    name, role = row
    return name, ROLE_LABELS.get(role, role)


def base_out(profile, *, technician_user_id: uuid.UUID | None,
             set_by_name: str | None = None,
             set_by_role: str | None = None) -> BaseLocationOut | None:
    """The base as one caller may see it, or None when there is none.

    Coordinates are copied at set time (W7), so the read is self-contained.
    `setBySelf` compares the setter against the technician's user id — a
    technician who set their own base reads as theirs on the profile.
    """
    if (
        profile.base_latitude is None
        or profile.base_longitude is None
        or profile.base_source is None
    ):
        return None
    return BaseLocationOut(
        latitude=profile.base_latitude,
        longitude=profile.base_longitude,
        pincode=profile.base_pincode,
        source=profile.base_source,
        setAt=profile.base_set_at,
        setBySelf=(
            profile.base_set_by_user_id is not None
            and profile.base_set_by_user_id == technician_user_id
        ),
        setByName=set_by_name,
        setByRole=set_by_role,
    )


__all__ = [
    "MANAGER_SOURCES",
    "TECHNICIAN_SOURCES",
    "BaseFix",
    "BaseLocationIn",
    "BaseLocationOut",
    "apply_base",
    "base_out",
    "check_in_india",
    "check_source_allowed",
    "resolve_base",
    "setter_label",
]