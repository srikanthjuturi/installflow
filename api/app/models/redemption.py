"""A technician cashing out their balance — paid by UPI, straight to their account.

## Nothing in this system can see the money

There is no payment gateway. The payer — the company's National Head, or an
Admin where it has none — scans a QR on their own phone and their bank talks to
the technician's bank. Neither bank ever talks to us, so there is no webhook and
nothing here can observe a payment happening. What gets recorded is therefore
two people's word, and each is kept as exactly that:

  * the PAYER **claims** "I paid", with a screenshot of the payment (required —
    it is the one artefact still on their phone at that moment) and the UTR
    (optional — a string they would have to go and find, and could mistype);
  * the TECHNICIAN **confirms** it arrived. They are the only party who can see
    the money, so they are the only one who may say it is there.

**`confirmed_at IS NOT NULL` is what "paid" means.** Not a status: a status
column would have to hold a value meaning "somebody says so", and the whole
design turns on never confusing that with the fact. There is deliberately no
code path, and no endpoint, that marks a redemption paid other than the
technician's own confirmation. An admin confirming would be inventing a fact.

## The amount is the server's, frozen

`amount_paise` is cut from the technician's balance when they ask and never
recomputed — a penalty landing a minute later comes off the NEXT redemption,
not this one. `upi_id` and `payee_name` are frozen for the same reason: a
technician who later changes where they are paid must not rewrite where an
open request tells the payer to send it.

## Only the payer can decline, and only before a claim

The technician has no cancel. Money can leave the payer's phone at any moment
after the QR is on their screen; a technician who cancelled meanwhile would
leave that payment landing on a dead row, the balance freed, and the same money
requestable twice. The payer is the only side that knows whether they have
paid, so the payer holds the decline — and once they have claimed, not even
they can, because money may have moved.

## One open redemption per technician

Open means neither confirmed nor declined (`uq_redemptions_one_open`). Only the
technician's own confirmation closes a claimed one, so their inaction blocks
only them — which is the incentive to confirm. Nothing auto-confirms on
silence, for the reason `sweep_force_close` closes nothing: it would record an
approval nobody gave.

## Not a ledger row

`ledger_entries.ticket_id` is NOT NULL and a redemption has no ticket;
installed apps render every ledger kind they are sent and would crash on an
unknown one; and a withdrawal inside a week's figures would make "Net payout
after penalties" read as a week in which they earned nothing. The balance
subtracts redemptions instead — see `redemptions.service.balance`.
"""

import datetime
import uuid

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: The most one redemption may be for: ₹1,00,000, the UPI per-transaction cap
#: for a person-to-person payment. A QR above it cannot be paid in one go, so a
#: larger balance is cut at this and the remainder stays for the next request.
UPI_MAX_PAISE = 1_00_000_00

#: What happened, in the trail. Only what the code writes.
REDEMPTION_EVENT_KINDS = (
    #: The technician asked to be paid. Carries the amount and the UPI ID it
    #: was frozen with, which are also on the row — but the trail should read
    #: on its own.
    "requested",
    #: The payer says they paid. May repeat: a mistyped UTR, a retried payment,
    #: or a nudge to a technician who has not looked. Each claim's proof lives
    #: HERE, because the row keeps only the latest.
    "claimed",
    #: The technician says it has not arrived. Nothing else changes — a payer
    #: who checked too early must be able to hear "not yet" without the request
    #: dying, and the technician may confirm later.
    "denied",
    #: The technician says it arrived. The fact this table exists to record.
    "confirmed",
    #: The payer refused it before paying, with a reason. Frees the amount.
    "declined",
)

REDEMPTION_ACTOR_KINDS = ("staff", "technician")


class Redemption(Base, IdMixin, AuditMixin):
    __tablename__ = "redemptions"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. RESTRICT, as on `ledger_entries`: a
    #: technician who has been paid cannot be deleted out from under the money.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: `RGT-RDM-0001`, from `core.sequences`.
    code: Mapped[str] = mapped_column(String(32), nullable=False)

    #: PAISE. Cut from the balance when requested, never recomputed.
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Where to pay, and who the payer's UPI app should show — both frozen.
    upi_id: Mapped[str] = mapped_column(String(256), nullable=False)
    payee_name: Mapped[str] = mapped_column(String(120), nullable=False)

    # ── the payer's claim — the LATEST one; every claim is also an event ─────
    claimed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: No FK, like `created_by`: users are soft-deleted, never removed.
    claimed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: Their name at the time, for the technician's screen and the trail.
    claimed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    utr: Mapped[str | None] = mapped_column(String(35), nullable=True)
    #: A private blob name (`attachment/<company>/…`), signed on read.
    proof_blob_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── the technician's confirmation — what "paid" means ────────────────────
    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── the payer's refusal, before any claim ────────────────────────────────
    declined_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    declined_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    declined_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    decline_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)

    __table_args__ = (
        # The composite FK target for `redemption_events`. TOTAL — a partial
        # index cannot be a foreign key target.
        UniqueConstraint("company_id", "id", name="uq_redemptions_company_id_id"),
        UniqueConstraint("company_id", "code", name="uq_redemptions_company_code"),
        # `> 0`: a zero-rupee redemption is not a smaller request, it is none.
        CheckConstraint("amount_paise > 0", name="amount_paise"),
        # The same backstop `technician_profiles.upi_id` carries. The real rule
        # is `core.upi`; this only stops something that is plainly not an
        # address reaching a payer's QR by a path that skipped it.
        CheckConstraint(
            "position('@' in upi_id) > 1 AND upi_id !~ '\\s' "
            "AND length(upi_id) >= 3",
            name="upi_id",
        ),
        # A claim without its screenshot is only a sentence.
        CheckConstraint(
            "(claimed_at IS NULL) = (proof_blob_name IS NULL)", name="claim_has_proof"
        ),
        # Only a claimed redemption can be confirmed, and only an unclaimed one
        # declined — which together mean it can never be both.
        CheckConstraint(
            "confirmed_at IS NULL OR claimed_at IS NOT NULL",
            name="confirmed_after_claim",
        ),
        CheckConstraint(
            "declined_at IS NULL OR claimed_at IS NULL", name="declined_before_claim"
        ),
        CheckConstraint(
            "(declined_at IS NULL) = (decline_reason IS NULL)",
            name="decline_has_reason",
        ),
        # One open redemption per technician. See the module docstring.
        Index(
            "uq_redemptions_one_open",
            "company_id",
            "technician_id",
            unique=True,
            postgresql_where=text("confirmed_at IS NULL AND declined_at IS NULL"),
        ),
        # The technician's history, and the covering index for their FK.
        Index(
            "ix_redemptions_company_technician",
            "company_id",
            "technician_id",
            "created_at",
        ),
        # The console queue: one company's redemptions, newest first.
        Index("ix_redemptions_company_created", "company_id", "created_at"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_redemptions_company_technician",
            ondelete="RESTRICT",
        ),
    )


class RedemptionEvent(Base, IdMixin, AuditMixin):
    """What each side SAID, in order. Append-only.

    Not optional here, and not a nicety. The row above is current state: a
    second claim overwrites the first, and a "not yet" followed by "received"
    leaves no trace. With no gateway anywhere in the flow, this log is the only
    record that exists of who said what — and it is what somebody will be
    reading on the day the two sides disagree.
    """

    __tablename__ = "redemption_events"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__.
    redemption_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: Insertion order — see `ticket_events.seq` for why not `created_at`.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), nullable=False)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: A name, not an id — renaming somebody must not rewrite what they said.
    actor_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: On a `claimed` event: the UTR and screenshot THAT claim carried.
    utr: Mapped[str | None] = mapped_column(String(35), nullable=True)
    proof_blob_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('requested', 'claimed', 'denied', 'confirmed', 'declined')",
            name="kind",
        ),
        CheckConstraint("actor_kind IN ('staff', 'technician')", name="actor_kind"),
        # The trail: one redemption's events, oldest first — and the covering
        # index for the FK below.
        Index(
            "ix_redemption_events_company_redemption",
            "company_id",
            "redemption_id",
            "seq",
        ),
        ForeignKeyConstraint(
            ["company_id", "redemption_id"],
            ["redemptions.company_id", "redemptions.id"],
            name="fk_redemption_events_company_redemption",
            ondelete="CASCADE",
        ),
    )
