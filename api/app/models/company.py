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

    # created_by (→ users.id, the superadmin) comes from AuditMixin.

    # NB: the case-insensitive UNIQUE index on lower(slug) is created in the migration.
    __table_args__ = (Index("ix_companies_is_active", "is_active"),)
