"""What a vendor owes its company for the jobs it raised, and how it settles it.

## A credit LINE, drawn down at CLOSURE

A vendor is given a limit when it is created — `vendors.credit_limit_paise`,
stamped from `company_rules.vendor_credit_limit_paise`. Closing one of its
tickets draws that line down by the ticket's own stamped `vendor_price_paise`:
the vendor asked for the visit, the visit happened, and now it is owed for.

That is the opposite end of the money from `credits.py`, and the two share
nothing. Company credits are what the COMPANY pays the PLATFORM for a ticket
entering the system — charged at creation, never refunded, because what is
bought is the pool, the technicians rung and the WhatsApps sent. This is what a
VENDOR owes the COMPANY for work delivered — charged at closure, and cleared by
paying. Both gates apply to the same vendor at intake and either one alone
stops it.

## The arithmetic, in one place

    limit      vendors.credit_limit_paise
    used       sum(charge) - sum(payment)            (this table, summed)
    reserved   sum(vendor_price_paise) of this vendor's non-terminal tickets
    available  limit - used - reserved

A ticket moves from `reserved` to `used` when it closes and out of both when it
is cancelled, so a cancellation costs the vendor nothing — that falls out of the
model rather than needing a rule of its own. `core.vendor_credits` is the only
place the four are computed.

Reserving open tickets is what bounds the company's exposure. Without it a
vendor with 200 rupees of headroom could raise ten 1,500-rupee jobs, every gate
passing, and the overshoot would only be found as they closed one by one.

## The balance is summed, never stored

Append-only, magnitudes unsigned, `kind` carrying the direction — the reasoning
`core/ledger.py` gives for the penalty pool and `credits.py` for a company's
balance. A stored column would eventually disagree with its own rows, and
`technician_profiles.jobs_completed` is the postmortem for trying.

## Closure never refuses

A customer confirming a visit runs with no principal at all, and a force-closure
is a manager settling a case nobody else can. Neither may be blocked by what a
vendor owes. So `used` may pass `limit` and `available` may go negative — and
that is exactly what then stops the vendor's NEXT ticket. There is no floor
here and no minus limit: the reservation at intake is the bound.

## A payment is two people's word, like a recharge

There is no gateway. The vendor pays a UPI QR built from the COMPANY's own UPI
ID and CLAIMS it paid, with the UTR and a screenshot; an Admin or National Head
— the only party who can see the money arrive — CONFIRMS it, which is the one
thing that restores headroom. `confirmed_at IS NOT NULL` is what "paid" means.
They may reject it with a reason instead, and the vendor may cancel it, but only
before claiming: once it says it paid, money may have moved.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rules import LIMITS
from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin
from app.models.redemption import UPI_MAX_PAISE

#: The most one payment may be for — UPI's per-transaction limit, the cap a
#: redemption and a recharge already carry. A QR above it cannot be paid in one
#: go, so a vendor owing more than this settles it over several.
PAYMENT_MAX_PAISE = UPI_MAX_PAISE

#: The ceiling on a credit line, read from the one place every other bound in
#: this product is declared — `app.core.rules.LIMITS`, which the request schema
#: and the console's form read too, so the four cannot drift apart. Ten lakh
#: rupees: a number this big is certainly a typo, and a CHECK is where a typo
#: from a script rather than a form gets caught.
#:
#: A model importing `core.rules` is the shape `company_rules.py` already has.
#: Safe because `core.rules` has no module-level app imports of its own — every
#: model it touches it imports inside a function, precisely to avoid the cycle.
CREDIT_LIMIT_MAX_PAISE = LIMITS["vendor_credit_limit_paise"][1]

#: Which way an entry moves what a vendor owes. `charge` adds; `payment`
#: subtracts. Magnitudes are unsigned, as `ledger_entries` and `credit_entries`
#: both are.
VENDOR_CREDIT_ENTRY_KINDS = (
    #: One of this vendor's tickets closed. Keyed on the ticket, so the charge
    #: cannot happen twice however often a closure is retried.
    "charge",
    #: A payment somebody with the authority to see it confirmed had arrived.
    "payment",
)

#: Who started a payment, decided at INSERT and never changed.
#:
#: It is not a label — it selects which rules the row obeys, so it has to be
#: known before the row exists rather than inferred from who claimed it:
#:
#:   vendor  the QR flow. Capped at UPI's per-transaction limit, and a claim is
#:           the UTR AND the screenshot, because two people's word is the only
#:           evidence available: the vendor knows they sent it, the company knows
#:           it arrived.
#:   staff   money that reached the company's account by some other route — NEFT,
#:           RTGS, IMPS, a cheque, cash. Born claimed AND confirmed, uncapped,
#:           and needing neither a reference nor a screenshot.
#:
#: A staff record is deliberately ONE person's word, and that is not a hole in
#: the two-people rule — it is the rule applied honestly. The only party who can
#: see money land in the company's bank is the company. For a UPI payment the
#: vendor is a second, independent observer. For a NEFT the vendor has told
#: nobody and there is no second observer to have; asking them to "claim" a
#: transfer they already made would be theatre. What matters is that the trail
#: SAYS which it was, which is what this column is for.
PAYMENT_SOURCES = ("vendor", "staff")

#: A limit-increase request's life. `pending` until somebody decides, then
#: `approved` or `rejected`; `cancelled` is the vendor withdrawing it. The
#: vocabulary `vendor_brands` and `upi_change_requests` already use.
VENDOR_CREDIT_REQUEST_STATUSES = ("pending", "approved", "rejected", "cancelled")

#: The backstop `technician_profiles.upi_id` carries; `core.upi` is the rule.
_VPA_CHECK = "position('@' in {col}) > 1 AND {col} !~ '\\s' AND length({col}) >= 3"


class VendorPayment(Base, IdMixin, AuditMixin):
    """A vendor settling what it owes: asked for, claimed paid, then decided.

    State is the timestamps, derived in one place
    (`features.vendor_credits.service.state_of`): to_pay -> waiting (claimed) ->
    paid (confirmed) | rejected, or cancelled before a claim. There is no status
    column, for the reason `redemptions` and `credit_recharges` have none — a
    word beside the timestamps is a second answer that can disagree with them.
    """

    __tablename__ = "vendor_payments"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. RESTRICT, like `vendor_brands`: a
    #: vendor is soft-deleted, and a payment it made is a fact about money.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: `RGT-VPY-0001`, from `core.sequences`. The UPI `tr` too, hyphens
    #: stripped, so it is the handle on both parties' bank statements.
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    #: PAISE, and NOT restricted to whole rupees — which is the opposite of
    #: `credit_recharges.amount_paise` beside it, deliberately.
    #:
    #: There, one credit IS one rupee, so a fractional amount would buy a
    #: fraction of an indivisible thing. Here the amount is a DEBT, and a debt is
    #: whatever the tickets came to: `vendor_price_paise` carries only `> 0`, so a
    #: vendor can owe 3,200 rupees and 50 paise. Requiring whole rupees here made
    #: that last 50 paise unpayable — the largest allowed payment left it behind,
    #: `maxPaymentPaise` went on reporting it, and every request for it was
    #: refused. A line permanently short by an amount nobody can clear.
    #:
    #: UPI itself is fine with it: `core.upi.format_amount` already renders paise
    #: as the two decimals the `am=` parameter takes.
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    #: The COMPANY's UPI ID and the name on it when this was asked for, frozen:
    #: an Admin changing where vendor payments go must not rewrite where an open
    #: request already told a vendor to send it.
    #:
    #: NULL on a STAFF record, and that is the honest value rather than a gap:
    #: money that arrived by NEFT did not go to a UPI address, and filling these
    #: in from the company's settings would assert a route it never took. It also
    #: means a company that has never set a UPI ID can still clear a vendor's line
    #: — which is most of the point of recording one.
    upi_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    payee_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: Who asked. No FK, like `created_by`: users are soft-deleted, never gone.
    requested_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: `vendor` or `staff` — see `PAYMENT_SOURCES`. Selects the rules below.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'vendor'")
    )
    #: How the money moved, for a staff record: `NEFT`, `Cheque 004512`, `Cash`.
    #:
    #: Free text within a length rather than an enum, the call
    #: `ForceCloseRequest.reason` makes: the console offers a fixed list and
    #: nothing else, but pinning it in a CHECK would mean a migration every time
    #: ops want another row in that list, and the value is read by people, never
    #: branched on by code. NULL on the vendor's own flow, where it is always UPI.
    method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: The day the money actually arrived, which is NOT the day somebody recorded
    #: it — a Friday transfer noticed on Monday is three days apart, and the
    #: statement it is reconciled against is ordered by the former.
    received_on: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    #: What it was against, in whoever recorded it's own words.
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # -- the vendor's claim ---------------------------------------------------
    claimed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    claimed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    claimed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    utr: Mapped[str | None] = mapped_column(String(35), nullable=True)
    #: A private blob name (`attachment/<company>/...`), signed on read.
    proof_blob_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # -- the company's confirmation — what "paid" means -----------------------
    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    confirmed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # -- ...or its refusal, after a claim -------------------------------------
    rejected_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    rejected_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)

    # -- ...or the vendor withdrawing it, before paying -----------------------
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    __table_args__ = (
        # The composite FK target for `vendor_credit_entries`. TOTAL — a partial
        # index cannot be a foreign key target.
        UniqueConstraint("company_id", "id", name="uq_vendor_payments_company_id_id"),
        UniqueConstraint("company_id", "code", name="uq_vendor_payments_company_code"),
        CheckConstraint(
            "source IN (" + ", ".join(f"'{v}'" for v in PAYMENT_SOURCES) + ")",
            name="source",
        ),
        # The UPI cap binds the VENDOR's flow only. It exists because a QR above
        # it cannot be paid in one go — which is a fact about UPI, not about what
        # a vendor may owe. A NEFT of ten lakh is one transfer, and capping the
        # record of it would mean filing one real payment as eleven fictional
        # ones.
        CheckConstraint(
            f"amount_paise > 0 "
            f"AND (source = 'staff' OR amount_paise <= {PAYMENT_MAX_PAISE})",
            name="amount_paise",
        ),
        # A staff record is the confirmation. There is nothing to wait for and
        # nobody else to hear from, so it is born decided — and, like every other
        # confirmed payment here, it cannot be taken back.
        CheckConstraint(
            "source <> 'staff' "
            "OR (claimed_at IS NOT NULL AND confirmed_at IS NOT NULL "
            "AND method IS NOT NULL AND received_on IS NOT NULL)",
            name="staff_record_is_complete",
        ),
        CheckConstraint(
            f"upi_id IS NULL OR ({_VPA_CHECK.format(col='upi_id')})", name="upi_id"
        ),
        # The vendor's own flow always has a payee — it is what the QR points at.
        CheckConstraint(
            "source <> 'vendor' OR (upi_id IS NOT NULL AND payee_name IS NOT NULL)",
            name="vendor_flow_has_payee",
        ),
        # Nothing claimed means no reference and no screenshot — there is nothing
        # for either to be evidence of yet.
        CheckConstraint(
            "claimed_at IS NOT NULL OR (utr IS NULL AND proof_blob_name IS NULL)",
            name="unclaimed_has_no_proof",
        ),
        # A VENDOR's claim is the UTR AND the screenshot — both, or it is only a
        # sentence. A staff record needs neither: cash carries no reference, and
        # the bank statement it was read off is not ours to attach.
        CheckConstraint(
            "source <> 'vendor' OR claimed_at IS NULL "
            "OR (utr IS NOT NULL AND proof_blob_name IS NOT NULL)",
            name="claim_complete",
        ),
        # Only a claim can be confirmed or rejected; only an unclaimed one
        # cancelled.
        CheckConstraint(
            "(confirmed_at IS NULL AND rejected_at IS NULL) OR claimed_at IS NOT NULL",
            name="decided_after_claim",
        ),
        CheckConstraint(
            "cancelled_at IS NULL OR claimed_at IS NULL", name="cancelled_before_claim"
        ),
        CheckConstraint(
            "num_nonnulls(confirmed_at, rejected_at, cancelled_at) <= 1",
            name="one_outcome",
        ),
        CheckConstraint(
            "(rejected_at IS NULL) = (reject_reason IS NULL)", name="reject_has_reason"
        ),
        # One open payment per vendor — a second QR beside the first is how the
        # same money gets paid twice.
        Index(
            "uq_vendor_payments_one_open",
            "company_id",
            "vendor_id",
            unique=True,
            postgresql_where=text(
                "confirmed_at IS NULL AND rejected_at IS NULL AND cancelled_at IS NULL"
            ),
        ),
        # The vendor's own history, newest first — and the FK's covering index.
        Index(
            "ix_vendor_payments_company_vendor_created",
            "company_id",
            "vendor_id",
            "created_at",
        ),
        # The staff queue: claims nobody has decided, across every vendor.
        Index(
            "ix_vendor_payments_waiting",
            "company_id",
            "claimed_at",
            postgresql_where=text(
                "claimed_at IS NOT NULL AND confirmed_at IS NULL "
                "AND rejected_at IS NULL"
            ),
        ),
        # One payment settles once. Scoped to the COMPANY, unlike the platform's
        # `uq_credit_recharges_credited_utr`, which is global: there the payee is
        # always the platform, so one UTR can only ever be one payment to it.
        # Here the payee is the company, and two companies are two payees — a
        # vendor paying each of them must not look like double-claiming.
        # Partial on paid: a rejected claim may be resubmitted with the UTR it
        # already had, which is what a vendor that did pay should do.
        Index(
            "uq_vendor_payments_credited_utr",
            "company_id",
            "utr",
            unique=True,
            postgresql_where=text("confirmed_at IS NOT NULL"),
        ),
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_payments_company_vendor",
            ondelete="RESTRICT",
        ),
    )


class VendorCreditRequest(Base, IdMixin, AuditMixin):
    """A vendor asking for a bigger line, and what was decided.

    The other way out of a used-up line — pay, or be given more room. Copied
    from `vendor_brands`' approval block and `upi_change_requests`' one-pending
    index, because it is the same shape: a vendor asks, a senior decides, and a
    rejection has to say why.

    `granted_limit_paise` is what was actually approved, which may be less than
    was asked for. The same judgement a force-closure's payout is: the person
    deciding knows things the person asking does not.
    """

    __tablename__ = "vendor_credit_requests"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: What the line was when they asked, frozen. Without it a decision read a
    #: year later cannot say what it actually changed.
    current_limit_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_limit_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Why they want it. Optional — the number is the request; this is context.
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    #: When it last ENTERED pending, so a resubmission sorts by its new wait.
    submitted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: What was approved. Null on every other outcome.
    granted_limit_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: No FK — an actor is a fact, and users are soft-deleted.
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    decided_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ("
            + ", ".join(f"'{s}'" for s in VENDOR_CREDIT_REQUEST_STATUSES)
            + ")",
            name="status",
        ),
        CheckConstraint(
            f"current_limit_paise >= 0 "
            f"AND current_limit_paise <= {CREDIT_LIMIT_MAX_PAISE}",
            name="current_limit_paise",
        ),
        # Asking for nothing more than you already have is not a request. The
        # service says so first, with a sentence; this is the backstop.
        CheckConstraint(
            f"requested_limit_paise > current_limit_paise "
            f"AND requested_limit_paise <= {CREDIT_LIMIT_MAX_PAISE}",
            name="requested_limit_paise",
        ),
        CheckConstraint(
            "(status = 'pending') = (decided_at IS NULL)", name="decided_when_closed"
        ),
        CheckConstraint(
            "(decided_at IS NULL) = (decided_by_user_id IS NULL)",
            name="decided_by_with_decided_at",
        ),
        CheckConstraint(
            "(status = 'rejected') = (reject_reason IS NOT NULL)",
            name="rejection_has_reason",
        ),
        # An approval is a number. No other outcome carries one.
        CheckConstraint(
            "(status = 'approved') = (granted_limit_paise IS NOT NULL)",
            name="granted_only_on_approved",
        ),
        CheckConstraint(
            f"granted_limit_paise IS NULL OR (granted_limit_paise >= 0 "
            f"AND granted_limit_paise <= {CREDIT_LIMIT_MAX_PAISE})",
            name="granted_limit_paise",
        ),
        CheckConstraint(
            "status <> 'pending' OR submitted_at IS NOT NULL",
            name="pending_was_submitted",
        ),
        # One open request per vendor. A queue of three from one vendor is three
        # answers to one question.
        Index(
            "uq_vendor_credit_requests_one_pending",
            "company_id",
            "vendor_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        # The staff queue and the FK's covering index in one.
        Index("ix_vendor_credit_requests_company_vendor", "company_id", "vendor_id"),
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_credit_requests_company_vendor",
            ondelete="RESTRICT",
        ),
    )


class VendorCreditEntry(Base, IdMixin, AuditMixin):
    """One movement of what a vendor owes. Append-only; the total is the sum."""

    __tablename__ = "vendor_credit_entries"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Always positive; `kind` says which way it moves what is owed.
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    #: COMPOSITE FKs — see __table_args__. RESTRICT: a ticket that has been
    #: billed, or a payment that has been credited, cannot be deleted out from
    #: under the money it moved.
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in VENDOR_CREDIT_ENTRY_KINDS) + ")",
            name="kind",
        ),
        CheckConstraint("amount_paise > 0", name="amount_paise"),
        CheckConstraint(
            "(kind = 'charge') = (ticket_id IS NOT NULL)", name="ticket_link"
        ),
        CheckConstraint(
            "(kind = 'payment') = (payment_id IS NOT NULL)", name="payment_link"
        ),
        # Each partial unique is also the covering index for its FK.
        # One charge per ticket, however many times a closure is retried...
        Index(
            "uq_vendor_credit_entries_company_ticket",
            "company_id",
            "ticket_id",
            unique=True,
            postgresql_where=text("ticket_id IS NOT NULL"),
        ),
        # ...and one credit per payment, however many times Confirm is pressed.
        Index(
            "uq_vendor_credit_entries_company_payment",
            "company_id",
            "payment_id",
            unique=True,
            postgresql_where=text("payment_id IS NOT NULL"),
        ),
        # The statement, newest first — and the total's own scan.
        Index(
            "ix_vendor_credit_entries_company_vendor_created",
            "company_id",
            "vendor_id",
            "created_at",
        ),
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_credit_entries_company_vendor",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_vendor_credit_entries_company_ticket",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["vendor_payments.company_id", "vendor_payments.id"],
            name="fk_vendor_credit_entries_company_payment",
            ondelete="RESTRICT",
        ),
    )
