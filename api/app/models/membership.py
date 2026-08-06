"""Membership = the link between a user and a company (pure link; no role).

Role comes from `users.role` (fixed per person). `manager_id` models the
per-company org tree and is constrained to the SAME company via a composite FK,
so a manager can never point at a membership in another tenant.
"""

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin


class Membership(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    # Self-ref org hierarchy; enforced same-company by the composite FK below.
    manager_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        UniqueConstraint("user_id", "company_id", name="uq_memberships_user_company"),
        # Target for the composite same-company FK (Postgres needs this unique).
        UniqueConstraint("company_id", "id", name="uq_memberships_company_id_id"),
        ForeignKeyConstraint(
            ["company_id", "manager_id"],
            ["memberships.company_id", "memberships.id"],
            name="fk_memberships_manager_same_company",
        ),
        Index("ix_memberships_company_id", "company_id"),
        Index("ix_memberships_company_created", "company_id", "created_at"),
    )
