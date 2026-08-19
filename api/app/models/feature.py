"""Backend-driven feature catalog + role defaults + per-company overrides.

Effective(company, role, feature) = COALESCE(
    company_role_features.enabled,   -- per-company override (sparse)
    role_feature_defaults.enabled,   -- shipped default
    false
)
Superadmin features are fixed in code and do NOT flow through these tables.
"""

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class Feature(Base, IdMixin, AuditMixin):
    """Global catalog of toggleable features / menu items."""

    __tablename__ = "features"

    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_key: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("features.key", ondelete="SET NULL"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    # A fixed 24-row catalogue, so this index buys nothing measurable. It is
    # here so the rule stays "every foreign key has a covering index" with no
    # list of exceptions to argue about — that is cheaper to keep than a
    # judgement call re-made per table.
    __table_args__ = (Index("ix_features_parent_key", "parent_key"),)


class RoleFeatureDefault(Base, IdMixin, AuditMixin):
    """Shipped baseline: which features a role gets by default (global)."""

    __tablename__ = "role_feature_defaults"

    role: Mapped[str] = mapped_column(
        String(32), ForeignKey("roles.key", ondelete="CASCADE"), nullable=False
    )
    feature_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("features.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        UniqueConstraint("role", "feature_id", name="uq_role_feature_default"),
        # The unique above leads with `role`, so it covers that FK already; this
        # is the other one.
        Index("ix_role_feature_defaults_feature_id", "feature_id"),
    )


class CompanyRoleFeature(Base, IdMixin, AuditMixin):
    """Per-company override of a role's feature (sparse — only where changed)."""

    __tablename__ = "company_role_features"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(
        String(32), ForeignKey("roles.key", ondelete="CASCADE"), nullable=False
    )
    feature_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("features.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "company_id", "role", "feature_id", name="uq_company_role_feature"
        ),
        Index("ix_company_role_features_company_role", "company_id", "role"),
        # The unique above leads with company_id, so it covers neither of these
        # FKs on its own.
        Index("ix_company_role_features_feature_id", "feature_id"),
        Index("ix_company_role_features_role", "role"),
    )
