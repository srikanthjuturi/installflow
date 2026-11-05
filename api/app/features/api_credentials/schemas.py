"""Wire shapes for the console's API credentials and the CRM's token exchange.

No shape here ever carries a secret except `ApiCredentialCreatedOut.clientSecret`,
which exists for the one response that creates a credential.
"""

import datetime
import uuid
from typing import Literal

from pydantic import Field, model_validator

from app.core.schemas import AppModel, EmailStatus

CredentialStatus = Literal["Active", "Revoked"]


class ApiCredentialOut(AppModel):
    id: uuid.UUID
    vendorId: uuid.UUID
    vendorName: str
    clientId: str
    note: str | None = None
    status: CredentialStatus
    createdAt: datetime.datetime
    lastUsedAt: datetime.datetime | None = None
    revokedAt: datetime.datetime | None = None
    #: Set when this credential was made with Replace.
    replacesId: uuid.UUID | None = None


class ApiCredentialCreateRequest(AppModel):
    vendorId: uuid.UUID
    note: str | None = Field(default=None, max_length=120)


class ApiCredentialCreatedOut(AppModel):
    credential: ApiCredentialOut
    #: In THIS response only. It is stored as a hash and cannot be shown again.
    clientSecret: str
    emailStatus: EmailStatus
    emailError: str | None = None


class TokenRequest(AppModel):
    """First sign-in (`clientId` + `clientSecret`) or renewal (`refreshToken`)."""

    clientId: str | None = Field(default=None, max_length=64)
    clientSecret: str | None = Field(default=None, max_length=200)
    refreshToken: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _one_way_in(self) -> "TokenRequest":
        has_pair = bool(self.clientId and self.clientSecret)
        has_refresh = bool(self.refreshToken)
        if has_pair == has_refresh:
            raise ValueError(
                "Send either clientId and clientSecret, or a refreshToken — not both, "
                "and not neither."
            )
        return self


class TokenOut(AppModel):
    accessToken: str
    tokenType: str = "Bearer"
    expiresIn: int
    refreshToken: str
    refreshExpiresIn: int


class ApiLogOut(AppModel):
    """One call a CRM made with a known credential."""

    id: uuid.UUID
    occurredAt: datetime.datetime
    vendorId: uuid.UUID
    vendorName: str
    credentialId: uuid.UUID
    clientId: str
    endpoint: str
    httpStatus: int
    #: The stable error code, or null when the call succeeded.
    outcomeCode: str | None = None
    reference: str | None = None
    checkOnly: bool = False
    repeat: bool = False
    ticketId: uuid.UUID | None = None
    #: A redacted summary of the request. NULL once 30 days have passed: the row
    #: is kept for a year, the details are not.
    summary: dict | None = None
    durationMs: int | None = None
