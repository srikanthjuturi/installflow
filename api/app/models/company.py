"""Company = tenant. The isolation boundary; all tenant data hangs off it."""

import uuid

from sqlalchemy import Boolean, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin


class Company(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    # Statutory identity. Manually entered today; the GST verification API will
    # auto-fill these from gst_number in a later phase.
    gst_number: Mapped[str] = mapped_column(String(15), nullable=False)
    pan: Mapped[str] = mapped_column(String(10), nullable=False)
    gst_company_status: Mapped[str] = mapped_column(String(64), nullable=False)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=False)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    pincode: Mapped[str] = mapped_column(String(10), nullable=False)

    # created_by (→ users.id, the superadmin) comes from AuditMixin.

    # NB: the case-insensitive UNIQUE indexes on lower(slug) and lower(gst_number)
    # are created in the migration.
    __table_args__ = (Index("ix_companies_is_active", "is_active"),)
