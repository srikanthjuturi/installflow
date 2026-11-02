"""Company <-> franchisee transfers, as the two sides see them (Epic 1.2)."""

import datetime
import re
import uuid
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, field_validator

from app.core.schemas import AppModel

Direction = Literal["company_to_franchisee", "franchisee_to_company"]
Reason = Literal["lease", "revenue_share", "advance", "adjustment", "other"]

#: Derived from the timestamps in `service.state_of`; there is no status column.
#:   awaiting   recorded; the receiving side has not said it arrived
#:   settled    the receiving side confirmed it
#:   declined   the receiving side said it did not arrive, with a reason
SettlementState = Literal["awaiting", "settled", "declined"]
SETTLEMENT_STATES: tuple[str, ...] = ("awaiting", "settled", "declined")
DIRECTIONS: tuple[str, ...] = ("company_to_franchisee", "franchisee_to_company")

#: A bank reference as people find it: letters and digits, 6 to 35.
_UTR = re.compile(r"^[A-Za-z0-9]{6,35}$")


def _optional_utr(value: str | None) -> str | None:
    if value is None:
        return None
    raw = str(value).strip().replace(" ", "")
    if not raw:
        return None
    if not _UTR.fullmatch(raw):
        raise ValueError(
            "Enter the reference as it appears on the bank statement - "
            "letters and digits, 6 to 35 of them"
        )
    return raw.upper()


Utr = Annotated[str | None, BeforeValidator(_optional_utr), Field(default=None)]


class ProofIn(AppModel):
    """A screenshot already uploaded to the private container - a NAME, not a URL."""

    blobName: str = Field(min_length=1, max_length=255)
    fileName: str | None = Field(default=None, max_length=255)


class RecordSettlementRequest(AppModel):
    """The sender recording a transfer.

    The DIRECTION is never sent: it is who you are. The company's Admin /
    National Head sends to the franchisee; the franchisee's admin sends to the
    company.
    """

    #: Required for the company's staff; ignored for a franchisee admin, who can
    #: only ever mean their own.
    franchiseeId: uuid.UUID | None = None
    amountPaise: int = Field(gt=0, le=10_000_000_000)
    reason: Reason
    note: str | None = Field(default=None, max_length=500)
    transferredOn: datetime.date
    utr: Utr = None
    proof: ProofIn

    @field_validator("note")
    @classmethod
    def _blank_note(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class DeclineSettlementRequest(AppModel):
    reason: str = Field(min_length=1, max_length=160)


class SettlementOut(AppModel):
    id: uuid.UUID
    code: str
    franchiseeId: uuid.UUID
    franchiseeName: str
    direction: Direction
    amountPaise: int
    reason: Reason
    note: str | None
    transferredOn: datetime.date
    utr: str | None
    #: A time-limited signed link, never the blob name.
    proofUrl: str | None
    state: SettlementState
    #: Which side has to act: `company` or `franchisee`; None once decided.
    waitingOn: Literal["company", "franchisee"] | None
    recordedByLabel: str | None
    createdAt: datetime.datetime
    confirmedAt: datetime.datetime | None
    confirmedByLabel: str | None
    declinedAt: datetime.datetime | None
    declinedByLabel: str | None
    declineReason: str | None
    #: The numbered document issued on confirmation, once there is one.
    documentNumber: str | None = None


class SettlementSummaryOut(AppModel):
    """Confirmed money only, summed live. `netPaise` > 0 means the company has
    paid the franchisee more than it has received from it."""

    franchiseeId: uuid.UUID | None
    companyToFranchiseePaise: int
    franchiseeToCompanyPaise: int
    netPaise: int
    awaitingCount: int


class SettlementCountOut(AppModel):
    """The rail badge: transfers waiting for THIS side to confirm."""

    awaitingMe: int


class FranchiseeOptionOut(AppModel):
    id: uuid.UUID
    name: str
