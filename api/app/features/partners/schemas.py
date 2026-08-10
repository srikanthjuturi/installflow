"""Partner invite request/response models."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field

from app.core.schemas import AppModel


def _e164(v: object) -> object:
    """Strip spaces/dashes and default a bare Indian 10-digit number to +91."""
    if not isinstance(v, str):
        return v
    digits = "".join(ch for ch in v if ch.isdigit() or ch == "+").lstrip("+")
    if not digits:
        return v
    if len(digits) == 10:  # bare local number — assume India
        digits = f"91{digits}"
    return f"+{digits}"


# WhatsApp needs the country code, so this is E.164, not an Indian 10-digit.
Phone = Annotated[str, BeforeValidator(_e164), Field(pattern=r"^\+[1-9]\d{7,14}$")]


class InviteCreateRequest(BaseModel):
    partnerType: Literal["freelancer", "franchise"]
    phone: Phone
    fullName: str | None = Field(default=None, max_length=255)
    # Optional for an area manager (their own region is used); required for
    # anyone covering more than one.
    regionId: uuid.UUID | None = None


class PartnerInviteOut(AppModel):
    id: uuid.UUID
    partnerType: str
    phone: str
    fullName: str | None
    status: str
    regionId: uuid.UUID
    regionName: str
    invitedByName: str | None
    invitedByEmail: str | None
    inviteLink: str
    failureReason: str | None
    sentAt: datetime | None
    registeredAt: datetime | None
    createdAt: datetime
