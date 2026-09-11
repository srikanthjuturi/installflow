"""What a redemption looks like to the technician who asked and the payer who pays."""

import datetime
import re
import uuid
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field

from app.core.schemas import AppModel

#: Derived from the timestamps in one place — `service.state_of` — and sent so
#: neither client re-derives it. There is no status column; see
#: `models/redemption.py` on why "paid" is a timestamp and not a value.
#:
#:   to_pay    asked for; nobody has said they paid
#:   awaiting  the payer says they paid; the technician has not confirmed
#:   settled   the technician confirmed it arrived
#:   declined  the payer refused it before paying
RedemptionState = Literal["to_pay", "awaiting", "settled", "declined"]
REDEMPTION_STATES: tuple[str, ...] = ("to_pay", "awaiting", "settled", "declined")

#: A UPI transaction reference as payers find it in their app: 12 digits for a
#: UPI RRN, longer and alphanumeric for some banks' own ids. Letters and digits
#: only — a reference is typed, compared and read out, never parsed.
_UTR = re.compile(r"^[A-Za-z0-9]{6,35}$")


def _optional_utr(value: str | None) -> str | None:
    """Blank is absent — the UTR is optional, the screenshot is the proof."""
    if value is None:
        return None
    raw = str(value).strip().replace(" ", "")
    if not raw:
        return None
    if not _UTR.fullmatch(raw):
        raise ValueError(
            "Enter the UTR as it appears in your UPI app — letters and digits, "
            "6 to 35 of them"
        )
    return raw.upper()


Utr = Annotated[str | None, BeforeValidator(_optional_utr), Field(default=None)]


class RedemptionEventOut(AppModel):
    """One thing somebody said, in the order they said it."""

    id: uuid.UUID
    kind: Literal["requested", "claimed", "denied", "confirmed", "declined"]
    at: datetime.datetime
    actorKind: Literal["staff", "technician"]
    actorLabel: str | None
    utr: str | None
    note: str | None


class RedemptionOut(AppModel):
    """A redemption as either side sees it in a list."""

    id: uuid.UUID
    code: str
    state: RedemptionState
    amountPaise: int
    #: Frozen when it was requested — where THIS request is paid, whatever the
    #: technician's profile says now.
    upiId: str
    payeeName: str
    requestedAt: datetime.datetime
    claimedAt: datetime.datetime | None
    #: The payer's name at the time they claimed.
    claimedBy: str | None
    utr: str | None
    confirmedAt: datetime.datetime | None
    declinedAt: datetime.datetime | None
    declinedBy: str | None
    declineReason: str | None
    #: When the technician last said "not yet" to the CURRENT claim. Null once
    #: the payer claims again — a new claim is a new question.
    deniedAt: datetime.datetime | None


class RedemptionDetailOut(RedemptionOut):
    """One redemption, with what it takes to pay it and what was said about it."""

    #: The finished `upi://pay?…` string — draw it, never parse or rebuild it.
    #: Null once there is nothing left to pay: a technician sees it only until
    #: somebody claims, a payer until it is settled or declined.
    upiUri: str | None
    #: The payer's screenshot, as a link that dies in fifteen minutes.
    proofUrl: str | None
    events: list[RedemptionEventOut]


class StaffRedemptionOut(RedemptionOut):
    """A row in the payer's queue — who it is for."""

    technicianId: uuid.UUID
    technicianName: str
    technicianCode: str


class StaffRedemptionDetailOut(RedemptionDetailOut):
    technicianId: uuid.UUID
    technicianName: str
    technicianCode: str
    #: So the payer can ring them — the other side of this is a person.
    technicianPhone: str | None


class RedeemableOut(AppModel):
    """The technician's redeem card: what they may ask for, and what is open."""

    #: Everything ever owed (payouts + bonuses − penalties) less every
    #: redemption not declined. May be negative.
    availablePaise: int
    #: What a request made now would be for: the available balance, floored at
    #: zero and capped at the UPI per-transaction limit. Zero means "nothing to
    #: redeem", and the app sends this figure back to prove what it showed.
    redeemablePaise: int
    #: Where it would be paid, or null — the card says to add one.
    upiId: str | None
    #: Who will be asked to pay it, for "Your National Head will be asked…".
    payerLabel: str
    #: The one open redemption, if any. While one is open no other can be made.
    open: RedemptionOut | None


class RedeemRequest(AppModel):
    """Asking to be paid.

    The amount is NOT a request for a sum — the server decides that from the
    ledger, and a client naming its own price is exactly what this design
    exists to prevent. It is the figure the technician was SHOWN, sent back so
    a balance that moved in between (a penalty landing a second earlier) is a
    409 they can read, rather than a request for a sum they never saw.
    """

    amountPaise: int = Field(gt=0)


class ConfirmRequest(AppModel):
    """`true`: it arrived — the only way a redemption is ever paid.
    `false`: it has not, yet. Nothing else changes; the payer is told."""

    received: bool


class ProofIn(AppModel):
    """The payer's screenshot, already uploaded to the private container.

    A NAME, not a URL — `POST /uploads?kind=attachment` first, the two-step
    every file here takes (see `ForceCloseAttachmentIn`).
    """

    blobName: str = Field(min_length=1, max_length=255)
    fileName: str | None = Field(default=None, max_length=255)


class ClaimRequest(AppModel):
    """The payer saying "I paid", with the screenshot that shows it.

    The screenshot is required and the UTR is not, and the asymmetry is the
    point: the screenshot is already on the payer's phone at this moment, while
    a UTR is a string they would have to go and find and could mistype. Neither
    PROVES anything — screenshots are easily faked — which is why the technician
    still has to confirm.
    """

    proof: ProofIn
    utr: Utr = None


class DeclineRequest(AppModel):
    """Refusing a redemption before paying it. The technician reads the reason."""

    reason: str = Field(min_length=1, max_length=160)


class RedemptionCountOut(AppModel):
    """The rail badge: redemptions nobody has paid yet."""

    toPay: int
