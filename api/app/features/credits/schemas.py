"""What credits and recharges look like to a company and to the superadmin."""

import datetime
import re
import uuid
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, model_validator

from app.core.schemas import AppModel
from app.core.upi import OptionalUpiName, UpiId
from app.models.credits import LIMITS

#: Derived from the timestamps in one place — `service.state_of` — and sent so
#: no client re-derives it. There is no status column; see `models/credits.py`.
#:
#:   to_pay     asked for; the company has not said it paid
#:   waiting    the company says it paid; the superadmin has not decided
#:   credited   the superadmin confirmed it arrived, and the credits were added
#:   rejected   the superadmin said it did not, with a reason
#:   cancelled  the company withdrew it before paying
RechargeState = Literal["to_pay", "waiting", "credited", "rejected", "cancelled"]
RECHARGE_STATES: tuple[str, ...] = ("to_pay", "waiting", "credited", "rejected", "cancelled")

EntryKind = Literal["free", "ticket", "recharge"]
ENTRY_KINDS: tuple[str, ...] = ("free", "ticket", "recharge")

#: A UPI transaction reference — the redemption rule, but REQUIRED here: a
#: recharge is matched against the platform's own statement, and the UTR is the
#: one handle both sides of that match share.
_UTR = re.compile(r"^[A-Za-z0-9]{6,35}$")


def _required_utr(value: str | None) -> str:
    raw = str(value or "").strip().replace(" ", "")
    if not raw:
        raise ValueError("Enter the UTR / reference ID from your UPI app")
    if not _UTR.fullmatch(raw):
        raise ValueError(
            "Enter the UTR as it appears in your UPI app — letters and digits, "
            "6 to 35 of them"
        )
    return raw.upper()


Utr = Annotated[str, BeforeValidator(_required_utr)]


# ── the balance ──────────────────────────────────────────────────────────────


class RechargeOut(AppModel):
    """A recharge as either side sees it in a list."""

    id: uuid.UUID
    code: str
    state: RechargeState
    amountPaise: int
    #: What it buys — one credit per rupee.
    credits: int
    #: The platform's UPI ID and name when it was asked for, frozen.
    upiId: str
    payeeName: str
    requestedAt: datetime.datetime
    requestedBy: str | None
    claimedAt: datetime.datetime | None
    claimedBy: str | None
    utr: str | None
    confirmedAt: datetime.datetime | None
    confirmedBy: str | None
    rejectedAt: datetime.datetime | None
    rejectedBy: str | None
    rejectReason: str | None
    cancelledAt: datetime.datetime | None


class RechargeDetailOut(RechargeOut):
    #: The finished `upi://pay?…` string — draw it, never rebuild it. Only while
    #: nothing has been claimed: after that a QR invites paying twice.
    upiUri: str | None
    #: The company's screenshot, as a link that dies in fifteen minutes.
    proofUrl: str | None


class CreditSummaryOut(AppModel):
    """The company's Credits page: where it stands and what it may do."""

    #: Credits left. Negative once it is using minus credits.
    balance: int
    ticketCredits: int
    minusCreditLimit: int
    #: The next ticket would be refused.
    paused: bool
    minRechargeRupees: int
    maxRechargeRupees: int
    #: False until the superadmin has set the platform's UPI ID.
    rechargeAvailable: bool
    #: The one open recharge, if any — no other can be asked for meanwhile.
    openRecharge: RechargeOut | None


class CreditEntryOut(AppModel):
    """One line of the statement."""

    id: uuid.UUID
    kind: EntryKind
    #: SIGNED here, for the statement: a ticket reads −10, a recharge +500.
    credits: int
    at: datetime.datetime
    ticketId: uuid.UUID | None
    ticketCode: str | None
    rechargeId: uuid.UUID | None
    rechargeCode: str | None


# ── the company's requests ───────────────────────────────────────────────────


class RechargeRequest(AppModel):
    """Asking to recharge. Whole rupees; the bounds are checked against the rules."""

    amountRupees: int = Field(gt=0)


class ProofIn(AppModel):
    """The payment screenshot, already uploaded to the private container.

    A NAME, not a URL — `POST /uploads?kind=attachment` first, as a redemption
    claim does.
    """

    blobName: str = Field(min_length=1, max_length=255)
    fileName: str | None = Field(default=None, max_length=255)


class RechargeClaimRequest(AppModel):
    """The company saying it paid: the UTR and the screenshot, both required."""

    utr: Utr
    proof: ProofIn


# ── the superadmin ───────────────────────────────────────────────────────────


class PlatformRechargeOut(RechargeOut):
    """A row in the superadmin's queue — which company it is from."""

    companyId: uuid.UUID
    companyName: str
    companyCode: str


class UtrMatchOut(AppModel):
    """Another recharge that carries the same UTR."""

    id: uuid.UUID
    code: str
    companyName: str
    state: RechargeState


class PlatformRechargeDetailOut(RechargeDetailOut):
    companyId: uuid.UUID
    companyName: str
    companyCode: str
    #: What the company has now, so confirming can be read against it.
    companyBalance: int
    #: Every OTHER claimed recharge with this UTR, any company. One payment is
    #: one UTR, so a match is either a legitimate resubmission after a rejection
    #: or the same money being claimed twice — the superadmin decides which.
    utrAlsoOn: list[UtrMatchOut]


class RechargeRejectRequest(AppModel):
    """Refusing a claimed recharge. The company reads the reason."""

    reason: str = Field(min_length=3, max_length=160)


class RechargeCountOut(AppModel):
    """The superadmin's badge and bell: claims nobody has decided."""

    waiting: int


def _bounded(key: str) -> dict:
    low, high = LIMITS[key]
    return {"ge": low, "le": high}


class PlatformSettingsOut(AppModel):
    freeCredits: int
    ticketCredits: int
    minusCreditLimit: int
    minRechargeRupees: int
    upiId: str | None
    upiName: str | None
    updatedAt: datetime.datetime | None


class PlatformSettingsIn(AppModel):
    """The superadmin's Rules. Credits are rupees, one for one."""

    freeCredits: int = Field(**_bounded("free_credits"))
    ticketCredits: int = Field(**_bounded("ticket_credits"))
    minusCreditLimit: int = Field(**_bounded("minus_credit_limit"))
    minRechargeRupees: int = Field(**_bounded("min_recharge_credits"))
    upiId: UpiId = None
    upiName: OptionalUpiName = None

    @model_validator(mode="after")
    def _upi_pair(self) -> "PlatformSettingsIn":
        # An address with no name to check it against, or a name with nowhere
        # to pay, is half a payee — the table refuses it too.
        if (self.upiId is None) != (self.upiName is None):
            raise ValueError("Enter both the UPI ID and the name on the UPI account")
        return self
