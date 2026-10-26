"""A technician moved from one franchisee to another — the audit (Task 17).

A technician belongs to one franchisee. Moving them is a deliberate act with
consequences (their pool, their payer, their pincodes), so it is written down:
who, when, why, from, to, and the exact pincodes before and after. The row is
written in the SAME transaction as the move (hard rule 8: a table with a writer
— `features/technicians/transfer_service.transfer_technician`).

**Append-only; a correction is another transfer.** No edit, no undo, and no
`SoftDeleteMixin`: an audit line that can be hidden is not one. The downgrade of
its migration refuses while any row exists, because dropping the table would
lose the only record of why a technician is where they are.

The technician link CASCADEs (history *about* a technician, the
`upi_change_requests` shape — profiles are soft-removed, never deleted). The two
franchisee links RESTRICT (franchisees are never deleted either). The acting
user has no FK, like `claimed_by_user_id`: users are soft-deleted, and the label
beside it keeps the line readable on its own.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class TechnicianTransfer(Base, IdMixin, AuditMixin):
    __tablename__ = "technician_transfers"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: The three links below are COMPOSITE FKs — see __table_args__.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    from_franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    to_franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: The type AT transfer time. It does not change in the move (D3), but a
    #: later statement should not have to infer it.
    technician_type: Mapped[str] = mapped_column(String(16), nullable=False)
    #: What the person typed, stripped.
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Sorted arrays of 6-digit strings. `coverage_after` is never empty — a
    #: technician with no coverage is matched by nothing.
    coverage_before: Mapped[list] = mapped_column(JSONB, nullable=False)
    coverage_after: Mapped[list] = mapped_column(JSONB, nullable=False)
    #: No FK, like `claimed_by_user_id`.
    transferred_by_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: Their name at the time, so the line reads on its own.
    transferred_by_label: Mapped[str] = mapped_column(String(120), nullable=False)
    transferred_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("from_franchisee_id <> to_franchisee_id", name="different_franchisees"),
        CheckConstraint("char_length(btrim(reason)) >= 5", name="reason_length"),
        CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        CheckConstraint(
            "jsonb_typeof(coverage_before) = 'array' AND jsonb_typeof(coverage_after) = 'array' "
            "AND jsonb_array_length(coverage_after) > 0",
            name="coverage_shape",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_transfers_company_technician",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "from_franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_technician_transfers_company_from",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "to_franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_technician_transfers_company_to",
            ondelete="RESTRICT",
        ),
        # The profile's history, and the covering index for the technician FK.
        Index(
            "ix_technician_transfers_company_technician",
            "company_id",
            "technician_id",
            "transferred_at",
        ),
        # Covering indexes for the two franchisee FKs.
        Index("ix_technician_transfers_company_from", "company_id", "from_franchisee_id"),
        Index("ix_technician_transfers_company_to", "company_id", "to_franchisee_id"),
    )
