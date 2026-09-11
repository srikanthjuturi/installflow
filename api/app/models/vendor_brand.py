"""The brands a vendor sells — what a product actually carries.

A vendor is a COMPANY: Crestline Distributors, with a GSTIN, a contact and a
login. A brand is what is printed on the box: Meridian, Sunview. One vendor
sells several, and until this table existed the product master pretended the two
were the same thing, printing "Crestline Distributors" where a technician or a
customer expects "Sunview".

## Two doors in, one of them reviewed

Staff add brands on the vendor form, and those are **approved** as they are
written — the people who set up the vendor are the people who would approve it.
A vendor adds its own from the portal, and those wait for a National Head or an
Admin on the Approvals screen, exactly as a vendor-submitted product does. The
approval columns and their CHECKs are `product_models`' five, for the same
reasons, and `core.product_tree`'s states are shared rather than copied.

Only an **approved** brand can be put on a product, and an approved brand can
never go back to pending — staff rename it, and staff remove it only when no live
product carries it. So every live product's brand is always approved, and intake
needs no gate of its own.

## Why not a list on the vendor

`vendors.intake_channels` is JSONB because it is bounded, read whole and never
queried alone. A brand is none of those: it carries its own approval state, it
is the target of `product_models`' foreign key, and its name is unique per
vendor. That is a table.

⚠ Named `VendorBrand`, never `Brand`, and never a bare `brand` variable in a
service: `app.core.brand` is the company WHITE-LABEL module — a different idea
entirely — and `tickets`, `jobs` and `vendors` already import it by that name.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.product_tree import APPROVAL_STATES
from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin

#: The longest brand name. A brand is what is printed on a product and read on
#: a job card, not a legal name — `vendors.name` is 255 for the legal kind.
MAX_BRAND_NAME = 120


class VendorBrand(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "vendor_brands"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. A brand belongs to one vendor; two
    #: vendors that both sell "Sunview" hold two rows.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(MAX_BRAND_NAME), nullable=False)

    #: `pending | approved | rejected`. Defaults to pending, which fails CLOSED:
    #: a writer that forgets produces a brand nobody can use and that sits in the
    #: approvals queue — the call `product_models.approval_status` made.
    approval_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    #: When this last ENTERED pending — a vendor's submission, or its edit of a
    #: rejected brand. NULL means it never waited (staff-added, or backfilled).
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: The deciding user. No FK, for `AuditMixin`'s reason: an actor is a fact
    #: about what happened, and must survive the account being removed.
    decided_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: Why it was refused, in words the VENDOR reads. 255, because it is quoted
    #: verbatim into `notifications.detail`, which is 255.
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "approval_status IN ("
            + ", ".join(f"'{state}'" for state in APPROVAL_STATES)
            + ")",
            name="approval_status",
        ),
        # `product_models`' four, for its reasons: a pending brand carries no
        # stale decision, a decision names who, a reason appears iff rejected,
        # and a pending brand was submitted.
        CheckConstraint(
            "approval_status <> 'pending' "
            "OR (decided_at IS NULL AND decided_by IS NULL)",
            name="pending_has_no_decision",
        ),
        CheckConstraint(
            "(decided_at IS NULL) = (decided_by IS NULL)",
            name="decided_by_with_decided_at",
        ),
        CheckConstraint(
            "(approval_status = 'rejected') = (rejection_reason IS NOT NULL)",
            name="rejection_reason_only_on_rejected",
        ),
        CheckConstraint(
            "approval_status <> 'pending' OR submitted_at IS NOT NULL",
            name="pending_was_submitted",
        ),
        # What a product's composite FK points at, and the covering index for
        # the vendor FK below by its `(company_id, vendor_id)` prefix. TOTAL — a
        # partial index cannot be a foreign key target.
        #
        # The name-per-vendor uniqueness is a hand-written partial `lower()`
        # index in the migration (`uq_vendor_brands_vendor_name_lower`):
        # `Index()` cannot express it, so it lives only there.
        UniqueConstraint(
            "company_id", "vendor_id", "id", name="uq_vendor_brands_company_vendor_id"
        ),
        # RESTRICT — a vendor is only ever soft-deleted, and a hard delete that
        # took its brands would take its products' brands with them.
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_vendor_brands_company_vendor",
            ondelete="RESTRICT",
        ),
    )
