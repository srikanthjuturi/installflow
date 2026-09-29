"""Company = tenant. The isolation boundary; all tenant data hangs off it."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin


class Company(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    #: The short token every human-facing code starts with — `RGT` in
    #: `RGT-INST-0001`. Set once at creation and never updated: tickets store
    #: the formatted string, so a code that moved would leave a company's older
    #: rows spelling a prefix it no longer uses. See `app.core.company_code`.
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Mandatory, like `vendors.phone` — a tenant nobody can ring is a tenant
    #: whose only contact route is the admin mailbox. Stored E.164, normalised
    #: by `app.core.phone.Phone` on the way in.
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    # Statutory identity. Manually entered today; the GST verification API will
    # auto-fill these from gst_number in a later phase.
    gst_number: Mapped[str] = mapped_column(String(15), nullable=False)
    pan: Mapped[str] = mapped_column(String(10), nullable=False)
    gst_company_status: Mapped[str] = mapped_column(String(64), nullable=False)
    #: ONE box, like `vendors.address` — same width, same reason. It was two
    #: lines until `e6b40d92c7a5`, which folded line 2 in with a newline; the
    #: textarea keeps those, so a pasted letterhead address survives intact.
    address_line1: Mapped[str] = mapped_column(String(500), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    pincode: Mapped[str] = mapped_column(String(10), nullable=False)

    #: Where this company's VENDORS send what they owe it, and the name their
    #: UPI app should show them. `platform_settings` carries the same pair one
    #: level up, for the platform's own recharges; this is the company as payee
    #: rather than as payer.
    #:
    #: Null until somebody sets them, and a vendor's Pay page says so rather
    #: than drawing a QR nobody could honour. Set by the company's own Admin or
    #: National Head on Rules configuration, and by the superadmin's company
    #: form — two writers for one pair, as `technician_profiles.upi_id` has.
    upi_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    upi_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # created_by (→ users.id, the superadmin) comes from AuditMixin.

    # NB: the case-insensitive UNIQUE indexes on lower(slug), lower(gst_number)
    # and lower(code) are created in the migration.
    __table_args__ = (
        Index("ix_companies_is_active", "is_active"),
        # The backstop `technician_profiles.upi_id` carries; `core.upi` is the
        # rule.
        CheckConstraint(
            "upi_id IS NULL OR (position('@' in upi_id) > 1 AND upi_id !~ '\\s' "
            "AND length(upi_id) >= 3)",
            name="upi_id",
        ),
        # An address without the name a payer checks it against, or a name with
        # nowhere to pay, is half a payee.
        CheckConstraint("(upi_id IS NULL) = (upi_name IS NULL)", name="upi_pair"),
    )
