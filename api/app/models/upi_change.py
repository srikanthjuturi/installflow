"""A technician asking for their UPI ID to be changed.

## Adding is theirs; changing is a manager's

A technician ADDS their UPI ID themselves — scanned off their own UPI QR or
typed, with the name on the account — and proves it with a one-time code sent
to their registered WhatsApp number (`otp_codes.purpose = 'payout_account'`).
That is the whole of their power over it. Once one is on file it is where their
money goes, and redirecting it is the move a stolen or borrowed phone would
make, so a CHANGE is a request: the technician proposes the new UPI ID and
name, and a manager applies it — no code, because the manager is the check.

## Who is asked

The Area Manager whose states cover the technician's service pincodes; if none
does, the Regional Head of that region; then a National Head; then an Admin
(`core.coverage.upi_reviewer`). Resolved when the request is made and kept in
`reviewer_role`, so the technician's screen can say who it went to. Any manager
who can edit the technician may DECIDE it — the chain decides whose bell rings,
not who is allowed to act, so a reviewer who has left never strands a request.

## One pending request per technician

`uq_upi_change_requests_one_pending`. A second would leave two proposed
addresses and nothing to say which one the technician meant.

The row is the audit: what it was, what they asked for, who decided, when, and
— for a refusal — why. The profile keeps only the current value.
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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

UPI_CHANGE_STATUSES = ("pending", "approved", "rejected", "cancelled")


class UpiChangeRequest(Base, IdMixin, AuditMixin):
    __tablename__ = "upi_change_requests"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. CASCADE: a request about a technician
    #: who no longer exists has nothing left to change.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: What was on file when they asked — so the decision is made against the
    #: address being replaced, and the record still says so afterwards.
    old_upi_id: Mapped[str] = mapped_column(String(256), nullable=False)
    old_upi_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    new_upi_id: Mapped[str] = mapped_column(String(256), nullable=False)
    new_upi_name: Mapped[str] = mapped_column(String(120), nullable=False)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    #: Whose bell rang — `area_manager`, `regional_head`, `national_head` or
    #: `admin`. The technician's screen reads it; authorisation does not.
    reviewer_role: Mapped[str] = mapped_column(String(24), nullable=False)

    decided_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: No FK, like `created_by`: users are soft-deleted, never removed.
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    decided_by_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: Why it was refused. The technician reads it.
    reject_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')",
            name="status",
        ),
        CheckConstraint(
            "reviewer_role IN ('area_manager', 'regional_head', 'national_head', "
            "'admin')",
            name="reviewer_role",
        ),
        # The same backstop `technician_profiles.upi_id` carries; the real rule
        # is `core.upi`.
        CheckConstraint(
            "position('@' in new_upi_id) > 1 AND new_upi_id !~ '\\s' "
            "AND length(new_upi_id) >= 3",
            name="new_upi_id",
        ),
        # Decided exactly when it is no longer pending, and a refusal always
        # says why — a bare "rejected" gives the technician nothing to fix.
        CheckConstraint(
            "(status = 'pending') = (decided_at IS NULL)", name="decided_when_closed"
        ),
        CheckConstraint(
            "(status = 'rejected') = (reject_reason IS NOT NULL)",
            name="rejection_has_reason",
        ),
        Index(
            "uq_upi_change_requests_one_pending",
            "company_id",
            "technician_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        # The technician's history, and the covering index for their FK.
        Index(
            "ix_upi_change_requests_company_technician",
            "company_id",
            "technician_id",
            "created_at",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_upi_change_requests_company_technician",
            ondelete="CASCADE",
        ),
    )
