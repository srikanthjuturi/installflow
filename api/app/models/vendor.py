"""Vendors — the brands a company stocks, and who to call about them.

A vendor is a RECORD, not an account. Nobody signs in as one: the ops console
creates it and every product model points at exactly one, which is how a model
gets its brand. If vendors ever need a portal, this table gains a nullable
`user_id` and nothing here has to move.

Company-scoped like the product master. Two companies may both stock Samsung;
they each get their own row, because the contact person, the GSTIN they buy
against and whether the relationship is still live are all theirs alone.

`is_active` (Active / Paused) and `deleted_at` (Removed) are kept apart for the
same reason as in `product.py` — a paused vendor stays out of the brand picker
but is still the brand on every model already attributed to it.

Case-insensitive uniqueness on the name and the GSTIN is a hand-written
`lower()` index in the migration, partial on `deleted_at IS NULL` so removing a
vendor frees its name for reuse.
"""

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin


class Vendor(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    """A supplier company, used as the brand on a product model."""

    __tablename__ = "vendors"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: The trading name, and the label the brand picker shows.
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Statutory identity. Entered by hand today, like companies.
    gst_number: Mapped[str] = mapped_column(String(15), nullable=False)
    #: Nullable: only an MCA-registered company has a CIN. A proprietorship or a
    #: partnership vendor is perfectly normal and has none.
    cin: Mapped[str | None] = mapped_column(String(21), nullable=True)

    #: Who to ring, and on what number. Not a `users` row — this person does not
    #: sign in, and giving them an account would put them inside the tenant.
    contact_person: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)

    #: One free-text box, unlike `companies`, which splits line 1 / line 2. City,
    #: state and pincode stay separate because they are the parts anything
    #: downstream would ever filter or group on.
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    pincode: Mapped[str] = mapped_column(String(10), nullable=False)

    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("ix_vendors_company_id", "company_id"),
        # What product_models' composite FK points at, so a model physically
        # cannot be branded with another company's vendor.
        UniqueConstraint("company_id", "id", name="uq_vendors_company_id_id"),
    )
