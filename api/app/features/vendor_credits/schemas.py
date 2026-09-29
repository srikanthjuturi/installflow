"""What a vendor's credit line looks like — to the vendor, and to staff.

Read `models/vendor_credits.py` for the design and `core/vendor_credits.py` for
the arithmetic. Every amount here is PAISE, and there is no "credits" figure
anywhere in this slice: a vendor's charge is the ticket's own stamped
`vendor_price_paise`, not a flat number of credits, so converting it to whole
units would round somebody's bill.
"""

import datetime
import re
import uuid
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field

from app.core.rules import LIMITS
from app.core.schemas import AppModel
from app.models.vendor_credits import CREDIT_LIMIT_MAX_PAISE, PAYMENT_MAX_PAISE

#: Derived from the timestamps in one place — `service.state_of` — and sent so
#: no client re-derives it. There is no status column; see the model.
#:
#:   to_pay    asked for; the vendor has not said it paid
#:   waiting   the vendor says it paid; nobody has decided
#:   paid      an Admin or National Head confirmed it arrived, and the line moved
#:   rejected  they said it did not, with a reason
#:   cancelled the vendor withdrew it before paying
PaymentState = Literal["to_pay", "waiting", "paid", "rejected", "cancelled"]
PAYMENT_STATES: tuple[str, ...] = (
    "to_pay",
    "waiting",
    "paid",
    "rejected",
    "cancelled",
)

#: Who started a payment. Sent so a reader can tell "the vendor said it and we
#: agreed" from "we read it off the bank statement" — two different amounts of
#: evidence, and the screens say which.
PaymentSource = Literal["vendor", "staff"]

EntryKind = Literal["charge", "payment"]
ENTRY_KINDS: tuple[str, ...] = ("charge", "payment")

RequestStatus = Literal["pending", "approved", "rejected", "cancelled"]
REQUEST_STATUSES: tuple[str, ...] = ("pending", "approved", "rejected", "cancelled")

#: A UPI transaction reference. The recharge rule, and REQUIRED for the same
#: reason: this payment is matched against the company's own bank statement, and
#: the UTR is the one handle both sides of that match share.
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

#: The same bound `company_rules`' CHECK and the vendor form read.
_LIMIT_FLOOR = LIMITS["vendor_credit_limit_paise"][0]


# ── the line ─────────────────────────────────────────────────────────────────


class VendorCreditOut(AppModel):
    """A vendor's line, as the vendor itself sees it.

    ## Why a vendor sees its own figures at all

    The house rule elsewhere is that a spend figure is a CONSOLE figure — a
    vendor is told whether intake is paused and never how much its company has
    left, and `addressSearchCount` is on `VendorOut` and deliberately not on
    `MeVendorOut`. This departs from that, and the reason is the asymmetry
    between the two facts.

    An address search costs the vendor nothing and there is no action they could
    take about it. A credit line is a debt with a consequence they feel — their
    intake stops — and a remedy only they can carry out. Telling them "paused"
    without the number is an instruction to act with no way to know how much.

    Their COMPANY's balance with the platform stays hidden from them, unchanged.
    """

    limitPaise: int
    #: Billed at closure, less every payment somebody confirmed arrived.
    usedPaise: int
    #: The stamped price of tickets raised and not yet closed or cancelled. Not
    #: owed yet, and it may never be — a cancelled ticket bills nothing.
    reservedPaise: int
    #: `limit - used - reserved`. Negative once closures overtook the line.
    availablePaise: int
    #: Whether the next ticket is certainly refused.
    paused: bool

    #: The most this vendor could ask to pay right now — what is owed, capped at
    #: UPI's per-transaction limit. Zero when nothing is owed.
    maxPaymentPaise: int
    #: Whether the company has told us where to send money. False means no QR
    #: can be drawn, and the page says so rather than offering a dead button.
    paymentAvailable: bool
    #: The open payment, if there is one. At most one at a time.
    openPaymentId: uuid.UUID | None = None
    #: The pending limit request, if there is one. At most one at a time.
    pendingRequestId: uuid.UUID | None = None


class VendorCreditEntryOut(AppModel):
    """One movement on the statement."""

    id: uuid.UUID
    kind: EntryKind
    #: SIGNED for the statement — a charge is negative room. The stored
    #: magnitude is unsigned and `kind` carries the direction; this is the one
    #: place the two are combined, so no client has to know the rule.
    amountPaise: int
    #: The ticket this billed, for a `charge`.
    ticketId: uuid.UUID | None = None
    ticketCode: str | None = None
    #: The payment this credited, for a `payment`.
    paymentId: uuid.UUID | None = None
    paymentCode: str | None = None
    createdAt: datetime.datetime


# ── payments ─────────────────────────────────────────────────────────────────


class VendorPaymentOut(AppModel):
    """A payment as either side sees it in a list."""

    id: uuid.UUID
    code: str
    state: PaymentState
    amountPaise: int
    #: `vendor` for the QR flow, `staff` for money recorded off a bank statement.
    source: PaymentSource
    #: How it moved. NULL on the QR flow, where it is always UPI.
    method: str | None = None
    #: The day the money arrived — not the day it was recorded. NULL on the QR
    #: flow, where `claimedAt` already says when the vendor paid.
    receivedOn: datetime.date | None = None
    note: str | None = None
    #: Who the vendor is paying — frozen when the payment was asked for, so
    #: changing the company's UPI ID never rewrites an open request. NULL on a
    #: staff record: a NEFT went to no UPI address, and saying it did would
    #: assert a route the money never took.
    upiId: str | None = None
    payeeName: str | None = None
    utr: str | None = None
    requestedByLabel: str | None = None
    claimedAt: datetime.datetime | None = None
    claimedByLabel: str | None = None
    confirmedAt: datetime.datetime | None = None
    confirmedByLabel: str | None = None
    rejectedAt: datetime.datetime | None = None
    rejectedByLabel: str | None = None
    rejectReason: str | None = None
    cancelledAt: datetime.datetime | None = None
    createdAt: datetime.datetime
    #: Who is paying. On the LIST row and not only the detail, because the staff
    #: queue spans every vendor of the company and a reference code is not a
    #: party — a reviewer scanning it has to see who each claim is from without
    #: opening five of them. Null only if the join ever misses.
    vendorName: str | None = None


class VendorPaymentDetailOut(VendorPaymentOut):
    """One payment, with the things that cost a round trip to produce."""

    #: The `upi://pay?...` string, built by the server. Present ONLY while
    #: `to_pay`: a QR still on screen after a claim is an invitation to pay
    #: twice. Null for staff always — they are the payee, not the payer.
    upiUri: str | None = None
    #: A short-lived signed link to the screenshot. Null when blob storage is
    #: unconfigured, or when the stored name does not belong to this company.
    proofUrl: str | None = None


class VendorStandingOut(AppModel):
    """One vendor's line in the staff list, with enough to act on it."""

    vendorId: uuid.UUID
    vendorName: str
    isActive: bool
    limitPaise: int
    usedPaise: int
    reservedPaise: int
    availablePaise: int
    paused: bool
    #: So a row can offer "there is a claim waiting" without a second request.
    openPaymentId: uuid.UUID | None = None
    openPaymentState: PaymentState | None = None
    pendingRequestId: uuid.UUID | None = None


# ── limit requests ───────────────────────────────────────────────────────────


class VendorCreditRequestOut(AppModel):
    """A vendor asking for a bigger line, and what was decided."""

    id: uuid.UUID
    status: RequestStatus
    #: What the line was when they asked, frozen — without it a decision read
    #: later cannot say what it actually changed.
    currentLimitPaise: int
    requestedLimitPaise: int
    #: What was approved, which may be less than was asked. Null on every other
    #: outcome.
    grantedLimitPaise: int | None = None
    note: str | None = None
    submittedAt: datetime.datetime | None = None
    decidedAt: datetime.datetime | None = None
    decidedByLabel: str | None = None
    rejectReason: str | None = None
    vendorName: str | None = None
    createdAt: datetime.datetime


# ── requests in ──────────────────────────────────────────────────────────────


class PaymentRequest(AppModel):
    """The vendor asking to pay some or all of what it owes."""

    #: PAISE, and paise are allowed — see the model. A debt is whatever the
    #: tickets came to, so the exact amount owed must always be payable.
    #:
    #: The ceiling here is only UPI's per-transaction limit; the real one is what
    #: is owed, which the service checks against the live figure rather than
    #: trusting anything sent.
    amountPaise: int = Field(gt=0, le=PAYMENT_MAX_PAISE)


class ProofIn(AppModel):
    """A screenshot already uploaded to blob storage."""

    blobName: str = Field(min_length=1, max_length=255)
    fileName: str | None = Field(default=None, max_length=255)


class PaymentClaimRequest(AppModel):
    """"I have paid" — the UTR and the screenshot, both required.

    Both, or it is only a sentence. The same pair a recharge and a redemption
    claim carry, for the same reason: somebody has to be able to match this
    against a bank statement a year later.
    """

    utr: Utr
    proof: ProofIn


class RecordPaymentRequest(AppModel):
    """Staff writing down money that reached the company by some other route.

    This is the only door in this slice that moves a vendor's line on ONE
    person's word, and that is the two-people rule applied honestly rather than
    bent: the company's bank statement is the only evidence a NEFT leaves on our
    side, and the vendor — who has told nobody — is not a second observer waiting
    to be asked. `source='staff'` on the row is what keeps the trail unambiguous.

    It is final the moment it is written, exactly as confirming a vendor's
    payment is. There is no reversal in this product.
    """

    #: PAISE. Uncapped, unlike the QR flow: UPI's per-transaction limit is a fact
    #: about one QR, and a ten-lakh NEFT is one transfer.
    #:
    #: May exceed what is owed. An advance is a real thing a vendor does, and the
    #: line then reads as being in credit rather than the payment being refused.
    amountPaise: int = Field(gt=0, le=CREDIT_LIMIT_MAX_PAISE)
    #: `NEFT`, `RTGS`, `IMPS`, `Cheque`, `Cash`, `UPI` — the console offers a list
    #: and nothing else, but this is free text for the reason the model gives.
    method: str = Field(min_length=2, max_length=32)
    #: The day it ARRIVED. Not defaulted here: a Friday transfer recorded on
    #: Monday is three days apart, and only the person with the statement knows
    #: which day to write.
    receivedOn: datetime.date
    #: The UTR, cheque number or bank reference. Optional — cash has none.
    reference: str | None = Field(default=None, max_length=35)
    note: str | None = Field(default=None, max_length=255)
    #: A statement extract or a paying-in slip, if there is one. Optional: the
    #: bank line it was read off is not always ours to attach.
    proof: ProofIn | None = None


class RejectRequest(AppModel):
    """Turning something down. The reason is not optional."""

    reason: str = Field(min_length=3, max_length=160)


class LimitRequestIn(AppModel):
    """The vendor asking for a bigger line."""

    #: Must exceed the line they have — the model carries that as a CHECK and
    #: the service says so in words first. The ceiling is the one every other
    #: writer of this number reads.
    requestedLimitPaise: int = Field(gt=_LIMIT_FLOOR, le=CREDIT_LIMIT_MAX_PAISE)
    note: str | None = Field(default=None, max_length=500)


class LimitApproveRequest(AppModel):
    """Granting a line — not necessarily the one that was asked for.

    The amount is required rather than defaulting to what was requested. An
    approval is a decision about somebody else's money, and a body that omitted
    the number would make "approve" mean "grant whatever they typed", which is
    not a decision anybody took.
    """

    grantedLimitPaise: int = Field(ge=_LIMIT_FLOOR, le=CREDIT_LIMIT_MAX_PAISE)


class PaymentCountOut(AppModel):
    """The badge on the staff rail: claims nobody has decided."""

    waiting: int
    #: Limit requests nobody has decided. Counted separately because they are
    #: different work — one is money that may have arrived, the other is a
    #: policy decision — and the console shows them as two numbers.
    pendingRequests: int
