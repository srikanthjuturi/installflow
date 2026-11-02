"""Money between a company and one of its NON-home franchisees (Epic 1.2).

The product has never modelled this: a technician's money is the franchisee's
(`ledger_entries.franchisee_id`), but what an external franchisee pays the
company (a lease, a share) or the company pays it back was left out on purpose.
This is that ledger. It is a RECORD of two people's word -- no gateway, nothing
here can see a bank -- in the shape redemptions and recharges already use.

## Who says what

  * The party that SENT the money records it, with the proof (screenshot) and an
    optional UTR. The company's Admin / National Head records
    `company_to_franchisee`; the franchisee's own admin records
    `franchisee_to_company`.
  * The party that RECEIVED it confirms it arrived, or declines it with a
    reason. That confirmation is the one thing that makes a transfer count
    toward a balance; nobody can confirm their own.

## State is the timestamps

No status column, for the reason `redemptions` has none: a word beside the
timestamps is a second answer that can disagree with them
(`features.franchise_settlements.service.state_of`).

## Append-only

A confirmed or declined transfer is never edited or deleted. A wrong record is
declined by the receiver and re-entered. Balances are SUMMED live, never stored.
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
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

DIRECTIONS = ("company_to_franchisee", "franchisee_to_company")

#: Why the money moved. A closed list so the dashboard can group by it; `other`
#: with a note is the escape hatch, not a place to hide a category.
REASONS = ("lease", "revenue_share", "advance", "adjustment", "other")

def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class FranchiseSettlement(Base, IdMixin, AuditMixin):
    __tablename__ = "franchise_settlements"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: `RGT-FST-0001`, from `core.sequences`.
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[str] = mapped_column(String(24), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The day the money moved, as the sender states it (IST calendar date).
    transferred_on: Mapped[datetime.date] = mapped_column(Date, nullable=False)

    #: The bank reference, optional; and the screenshot, REQUIRED on every
    #: transfer -- a blob name under this company's private prefix, never a URL.
    utr: Mapped[str | None] = mapped_column(String(35), nullable=True)
    proof_blob_name: Mapped[str] = mapped_column(String(255), nullable=False)

    recorded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    recorded_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    confirmed_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    declined_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    declined_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    declined_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    decline_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)

    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_franchise_settlements_company_id_id"),
        UniqueConstraint("company_id", "code", name="uq_franchise_settlements_company_code"),
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_franchise_settlements_franchisee",
            ondelete="RESTRICT",
        ),
        CheckConstraint(f"direction IN ({_in(DIRECTIONS)})", name="direction"),
        CheckConstraint(f"reason IN ({_in(REASONS)})", name="reason"),
        CheckConstraint("amount_paise > 0", name="amount_paise"),
        # Decided once, one way: confirmed XOR declined XOR still waiting, and a
        # decline always says why.
        CheckConstraint(
            "NOT (confirmed_at IS NOT NULL AND declined_at IS NOT NULL)",
            name="decided_once",
        ),
        CheckConstraint(
            "declined_at IS NULL OR decline_reason IS NOT NULL",
            name="decline_has_reason",
        ),
        CheckConstraint(
            "reason <> 'other' OR note IS NOT NULL", name="other_has_note"
        ),
        Index("ix_franchise_settlements_franchisee", "company_id", "franchisee_id", "created_at"),
        Index("ix_franchise_settlements_company_created", "company_id", "created_at"),
    )
