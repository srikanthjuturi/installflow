"""The post offices (localities) inside a pincode -- Epic 7.

A pincode is a delivery area, and the thing a person actually writes after the
street is the LOCALITY: "Kothimir", "Banjara Hills". India Post publishes one
record per post office, and several offices share a pincode, so this is the list
the raise-ticket form offers once a valid pincode is typed.

## Global, like the geography it hangs off

No `company_id`: India is the same for every company, exactly as `pincodes` is.
Loaded by `app.scripts.import_post_offices` from the India Post directory
(`docs/pincodes.csv`); never written by a request.

## A suggestion, not a constraint

`tickets.locality` is free text. The directory is never complete or current, so a
locality that is not in this list must still be typeable -- this table feeds a
dropdown, it does not validate anything.
"""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: Branch, sub (post) and head offices -- the three kinds the directory holds.
OFFICE_TYPES = ("BO", "PO", "HO")


class PostOffice(Base, IdMixin, AuditMixin):
    __tablename__ = "post_offices"

    #: The master code, RESTRICT: a pincode with localities cannot be deleted
    #: (pincodes are switched off, never deleted, so this is belt and braces).
    pincode: Mapped[str] = mapped_column(
        String(6), ForeignKey("pincodes.code", ondelete="RESTRICT"), nullable=False
    )
    #: The office's name with the "B.O" / "S.O" / "H.O" suffix removed and spaces
    #: collapsed -- what a person would write. `Kothimir`, not `Kothimir B.O`.
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: `lower(name)`, stored so the uniqueness is a plain constraint rather than a
    #: hand-written functional index (Alembic cannot see those).
    name_key: Mapped[str] = mapped_column(String(80), nullable=False)
    office_type: Mapped[str] = mapped_column(String(2), nullable=False)
    #: False for the offices the directory marks "Non Delivery" -- still real
    #: places, but a courier does not deliver to them.
    delivers: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("pincode", "name_key", name="uq_post_offices_pincode_name"),
        CheckConstraint(
            "office_type IN (" + ", ".join(f"'{t}'" for t in OFFICE_TYPES) + ")",
            name="office_type",
        ),
        CheckConstraint(
            "(latitude IS NULL) = (longitude IS NULL)", name="coordinates_both_or_neither"
        ),
        # The lookup is always "offices of THIS pincode"; the unique above already
        # leads with it, but a covering index on the FK is the repo's rule.
        Index("ix_post_offices_pincode", "pincode"),
    )
