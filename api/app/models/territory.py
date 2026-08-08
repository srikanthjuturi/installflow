"""Territory: India → regions → areas identified by pincodes.

`regions` is GLOBAL reference data (geography, not tenant data) — the same five
regions for every company. A member's territory is expressed by the join tables:

    national_head  → no rows at all (all-India is the absence of a restriction)
    regional_head  → one or more `membership_regions`
    area_manager   → exactly one `membership_regions` + its `membership_pincodes`

Scope rows are the CURRENT assignment, not history, so they are hard-deleted
when a membership is removed — which frees the pincode for the next manager.
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


class Region(Base, IdMixin, AuditMixin):
    """One of the five parts of India. Seeded; not company-scoped."""

    __tablename__ = "regions"

    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )


class MembershipRegion(Base, IdMixin, AuditMixin):
    """A region this member covers. Many rows for an RH, exactly one for an AM."""

    __tablename__ = "membership_regions"

    membership_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    region_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("regions.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("membership_id", "region_id", name="uq_membership_region"),
        Index("ix_membership_regions_region_id", "region_id"),
    )


class MembershipPincode(Base, IdMixin, AuditMixin):
    """A pincode an area manager covers.

    `company_id` is denormalised from the membership purely so the UNIQUE below
    can exist: it is what actually enforces "a pincode belongs to one area
    manager" — an application-level check alone would race under concurrent
    writes.
    """

    __tablename__ = "membership_pincodes"

    membership_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    pincode: Mapped[str] = mapped_column(String(6), nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "pincode", name="uq_company_pincode"),
        Index("ix_membership_pincodes_membership_id", "membership_id"),
    )
