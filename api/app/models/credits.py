"""What a company pays for tickets with, and how it tops up.

## A credit is a rupee, spent when a ticket is RAISED

Every company starts with free credits and spends a fixed number on each ticket
it raises. The charge is made at creation — not at closure — because what the
company is paying for is the ticket entering the system: the pool, the
technicians rung, the WhatsApps sent. A later cancellation does not give it
back, for the same reason.

Once the balance is spent it may go on below zero, down to a floor. A ticket
that would take it past the floor is refused, and every ticket already raised
carries on untouched. The company's Admin or National Head recharges to lift it.

## The numbers are the PLATFORM's, not the company's

`platform_settings` is one row, belonging to no company: what a new company is
given, what a ticket costs, how far below zero anyone may go, and where recharge
payments are sent. The superadmin sets it on Rules. Free credits are a one-time
gift, stamped as an entry when a company is created, so changing the figure
later never re-gifts anybody; the per-ticket charge and the floor are read live,
so a change applies to every company from its next ticket.

## The balance is summed, never stored

`credit_entries` is append-only and the balance is its sum — the reasoning
`core/ledger.py` gives for the penalty pool, which is also a number a stored
column would eventually disagree with. Magnitudes are unsigned and `kind`
carries the direction, as `ledger_entries` does.

## A recharge is two people's word, like a redemption

There is no gateway. The company pays a UPI QR built from the platform's own
UPI ID and CLAIMS it paid, with the UTR and a screenshot; the superadmin, the
only party who can see the money arrive, CONFIRMS it — which is the one thing
that adds credits. `confirmed_at IS NOT NULL` is what "credited" means. A
superadmin may instead reject it with a reason, and the company may cancel it,
but only before claiming: once it says it paid, money may have moved.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin
from app.models.redemption import UPI_MAX_PAISE

#: One credit is one rupee.
PAISE_PER_CREDIT = 100

#: The most one recharge may be for — UPI's per-payment limit, the same cap a
#: redemption has. A QR above it cannot be paid in one go.
RECHARGE_MAX_PAISE = UPI_MAX_PAISE

#: What the platform ships with. `platform_settings` holds the superadmin's
#: values; a missing row is rebuilt from these (`core.credits`), the shape
#: `rules.DEFAULTS` gives a company's rules.
PLATFORM_DEFAULTS: dict[str, int] = {
    "free_credits": 1000,
    "ticket_credits": 10,
    "minus_credit_limit": 500,
    "min_recharge_credits": 100,
}

#: Inclusive bounds — read by the request schema and by the CHECKs below, so
#: the two cannot disagree. A per-ticket charge of 0 is allowed: it makes
#: tickets free, and charges nothing rather than writing a zero entry.
LIMITS: dict[str, tuple[int, int]] = {
    "free_credits": (0, 10_00_000),
    "ticket_credits": (0, 10_000),
    "minus_credit_limit": (0, 10_00_000),
    "min_recharge_credits": (1, RECHARGE_MAX_PAISE // PAISE_PER_CREDIT),
}

#: Which way an entry moves the balance. `ticket` subtracts; the rest add.
CREDIT_ENTRY_KINDS = (
    #: The one-time gift, when the company was created (or on launch day, for
    #: a company that already existed).
    "free",
    #: A ticket was raised.
    "ticket",
    #: The superadmin confirmed a recharge arrived.
    "recharge",
)


def _between(column: str) -> CheckConstraint:
    low, high = LIMITS[column]
    return CheckConstraint(f"{column} BETWEEN {low} AND {high}", name=column)


class PlatformSettings(Base, AuditMixin):
    """The platform's own configuration. Exactly one row, and no company.

    `id` is pinned to 1 by a CHECK rather than being a UUID, because "the"
    settings is the only row this table may ever hold — a second one would be
    a second answer to the same question.
    """

    __tablename__ = "platform_settings"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)

    #: Given to a company when it is created. Changing it gives nobody more.
    free_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    #: What each ticket costs, from the next ticket raised.
    ticket_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    #: How far below zero a company may go. The floor is its negative.
    minus_credit_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    #: The smallest recharge a company may ask for, in credits (= rupees).
    min_recharge_credits: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Where recharge payments go, and the name a payer's UPI app should show.
    #: Null until the superadmin sets them — recharging is unavailable until then.
    upi_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    upi_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        _between("free_credits"),
        _between("ticket_credits"),
        _between("minus_credit_limit"),
        _between("min_recharge_credits"),
        # The backstop `technician_profiles.upi_id` carries; `core.upi` is the rule.
        CheckConstraint(
            "upi_id IS NULL OR (position('@' in upi_id) > 1 AND upi_id !~ '\\s' "
            "AND length(upi_id) >= 3)",
            name="upi_id",
        ),
        # An address without the name the payer checks it against, or a name
        # with nowhere to pay, is half a payee.
        CheckConstraint("(upi_id IS NULL) = (upi_name IS NULL)", name="upi_pair"),
    )


class CreditRecharge(Base, IdMixin, AuditMixin):
    """A company topping up: asked for, claimed paid, then confirmed or not.

    State is the timestamps, derived in one place (`features.credits.service`):
    to_pay → waiting (claimed) → credited (confirmed) | rejected, or cancelled
    before a claim.
    """

    __tablename__ = "credit_recharges"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: `MA-RCH-0001`, from `core.sequences`.
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    #: PAISE, whole rupees only — one rupee buys one credit.
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    #: The platform's UPI ID and name when this was asked for, frozen: a
    #: superadmin changing where payments go must not rewrite where an open
    #: request tells a company to send it.
    upi_id: Mapped[str] = mapped_column(String(256), nullable=False)
    payee_name: Mapped[str] = mapped_column(String(120), nullable=False)

    #: Who asked. No FK, like `created_by`: users are soft-deleted, never removed.
    requested_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # ── the company's claim ──────────────────────────────────────────────────
    claimed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    claimed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    claimed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    utr: Mapped[str | None] = mapped_column(String(35), nullable=True)
    #: A private blob name (`attachment/<company>/…`), signed on read.
    proof_blob_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── the superadmin's confirmation — what "credited" means ────────────────
    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    confirmed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # ── …or the superadmin's refusal, after a claim ──────────────────────────
    rejected_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    rejected_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)

    # ── …or the company withdrawing it, before paying ────────────────────────
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    __table_args__ = (
        # The composite FK target for `credit_entries`. TOTAL — a partial index
        # cannot be a foreign key target.
        UniqueConstraint("company_id", "id", name="uq_credit_recharges_company_id_id"),
        UniqueConstraint("company_id", "code", name="uq_credit_recharges_company_code"),
        CheckConstraint(
            f"amount_paise > 0 AND amount_paise % {PAISE_PER_CREDIT} = 0 "
            f"AND amount_paise <= {RECHARGE_MAX_PAISE}",
            name="amount_paise",
        ),
        CheckConstraint(
            "position('@' in upi_id) > 1 AND upi_id !~ '\\s' AND length(upi_id) >= 3",
            name="upi_id",
        ),
        # A claim is the UTR AND the screenshot — both, or it is only a sentence.
        CheckConstraint(
            "(claimed_at IS NULL) = (utr IS NULL) "
            "AND (claimed_at IS NULL) = (proof_blob_name IS NULL)",
            name="claim_complete",
        ),
        # Only a claim can be confirmed or rejected; only an unclaimed one cancelled.
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
        # One open recharge per company — a second QR beside the first is how the
        # same payment gets made twice.
        Index(
            "uq_credit_recharges_one_open",
            "company_id",
            unique=True,
            postgresql_where=text(
                "confirmed_at IS NULL AND rejected_at IS NULL AND cancelled_at IS NULL"
            ),
        ),
        # The company's history, newest first.
        Index("ix_credit_recharges_company_created", "company_id", "created_at"),
        # The superadmin's queue, across every company: claims nobody has decided.
        Index(
            "ix_credit_recharges_waiting",
            "claimed_at",
            postgresql_where=text(
                "claimed_at IS NOT NULL AND confirmed_at IS NULL AND rejected_at IS NULL"
            ),
        ),
        # One payment buys credits once. A UTR identifies one UPI transaction, so
        # two CREDITED recharges carrying the same one are the same money counted
        # twice — across companies too, which is why this is not per company.
        # Partial on credited: a rejected claim may be resubmitted with the UTR
        # it already had, which is exactly what a company that did pay should do.
        Index(
            "uq_credit_recharges_credited_utr",
            "utr",
            unique=True,
            postgresql_where=text("confirmed_at IS NOT NULL"),
        ),
    )


class CreditEntry(Base, IdMixin, AuditMixin):
    """One movement of a company's balance. Append-only; the balance is the sum."""

    __tablename__ = "credit_entries"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Always positive; `kind` says which way it moves the balance.
    credits: Mapped[int] = mapped_column(Integer, nullable=False)

    #: COMPOSITE FKs — see __table_args__. RESTRICT: a charged ticket, or a
    #: credited recharge, cannot be deleted out from under what it cost.
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    recharge_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('free', 'ticket', 'recharge')", name="kind"),
        CheckConstraint("credits > 0", name="credits"),
        CheckConstraint("(kind = 'ticket') = (ticket_id IS NOT NULL)", name="ticket_link"),
        CheckConstraint(
            "(kind = 'recharge') = (recharge_id IS NOT NULL)", name="recharge_link"
        ),
        # Each partial unique is also the covering index for its FK.
        # One charge per ticket…
        Index(
            "uq_credit_entries_company_ticket",
            "company_id",
            "ticket_id",
            unique=True,
            postgresql_where=text("ticket_id IS NOT NULL"),
        ),
        # …one credit per recharge, however many times "confirm" is pressed…
        Index(
            "uq_credit_entries_company_recharge",
            "company_id",
            "recharge_id",
            unique=True,
            postgresql_where=text("recharge_id IS NOT NULL"),
        ),
        # …and one gift per company.
        Index(
            "uq_credit_entries_company_free",
            "company_id",
            unique=True,
            postgresql_where=text("kind = 'free'"),
        ),
        # The statement, newest first — and the balance's own scan.
        Index("ix_credit_entries_company_created", "company_id", "created_at"),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_credit_entries_company_ticket",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "recharge_id"],
            ["credit_recharges.company_id", "credit_recharges.id"],
            name="fk_credit_entries_company_recharge",
            ondelete="RESTRICT",
        ),
    )
