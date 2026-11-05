"""Where a customer bought the product online — a short, company-scoped master.

One list per company: Amazon, Flipkart, the company's own site, and whatever
else a company's vendors sell through. It exists so A7's `tickets.purchase_mode`
/ `purchase_platform_id` have something real to point at — a free-text field
would mean "Amazon", "amazon", "Amazon.in" and "AMAZON " all meaning the same
platform and counting as four on a report.

## Everyone reads it; only an Admin writes it

A vendor fills the raise-a-ticket form, a franchise principal sees the same
form in its own portal, and staff see it on the ticket detail — so the list
itself carries no feature gate (`features/purchase_platforms/router.py`'s own
reasoning). Only an Admin adds, renames or retires one: it is a short list a
company configures once, not a screen anybody works day to day.

## No hard delete

`tickets.purchase_platform_id` is a COMPOSITE FK into this table (see
`models/ticket.py`), RESTRICT. A platform that has ever been named on a ticket
cannot be removed out from under it — `is_active = false` is how one is
retired, the same `is_active` every other master in this product uses for
"paused, not gone".
"""

import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin

#: The longest platform name — a storefront's name, not a URL.
MAX_PLATFORM_NAME = 120


class PurchasePlatform(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "purchase_platforms"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(MAX_PLATFORM_NAME), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        # What a ticket's composite FK points at (`fk_tickets_company_purchase_
        # platform`). TOTAL, not partial — a partial index cannot be a foreign
        # key target.
        UniqueConstraint(
            "company_id", "id", name="uq_purchase_platforms_company_id_id"
        ),
        # The covering index for the company_id FK above — Postgres creates
        # none, and without it deleting a company would scan every platform in
        # the database to prove the CASCADE's own bookkeeping.
        Index("ix_purchase_platforms_company_id", "company_id"),
        # ⚠ The name-per-company uniqueness is a hand-written `lower()` partial
        # index in the migration — `uq_purchase_platforms_company_name_lower`
        # on `(company_id, lower(name))  WHERE deleted_at IS NULL`, so a
        # retired platform's name is free again. `Index()` cannot express
        # `lower()` with a WHERE, and `--autogenerate` will keep offering to
        # drop it on every future revision: delete that drop, the same trap
        # `uq_vendor_brands_vendor_name_lower` already documents.
    )
