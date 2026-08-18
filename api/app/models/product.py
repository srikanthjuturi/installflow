"""The product master: category → subcategory → model.

Company-scoped, unlike `regions`. Geography is the same for every tenant; a
product catalogue is not — Company B does not service Company A's range. So all
three tables carry `company_id`, and it is denormalised onto subcategories and
models so a list query is one index probe rather than a two-level join.

Two independent notions of "not available", deliberately kept apart:

    is_active   Active / Paused. A paused category stays out of new ticket
                intake but remains a valid reference for existing tickets.
    deleted_at  Removed. Soft, because tickets and technician certifications
                reference these rows forever.

Case-insensitive uniqueness is a hand-written `lower()` index in the migration
(the pattern `companies` already uses for slug and GSTIN), partial on
`deleted_at IS NULL` so deleting a category frees its name for reuse.

A technician certifies on a SUBCATEGORY — that is the level job offers match on.
"""

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKeyConstraint,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin


class ProductCategory(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    """Top level, e.g. Electric. Carries the icon both apps draw."""

    __tablename__ = "product_categories"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    #: One of `app.core.icons.PRODUCT_ICON_KEYS`. Validated in the schema layer,
    #: not by a CHECK — the catalogue changes with a deploy, and a CHECK would
    #: make adding an icon a migration.
    icon_key: Mapped[str] = mapped_column(String(32), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("ix_product_categories_company_id", "company_id"),
        # What a child's composite FK points at, so a subcategory physically
        # cannot hang off another company's category.
        UniqueConstraint("company_id", "id", name="uq_product_categories_company_id_id"),
    )


class ProductSubcategory(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    """Middle level, e.g. Television. What a technician is certified for."""

    __tablename__ = "product_subcategories"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: The FK is COMPOSITE, declared in __table_args__ — see there.
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Nullable, and the API resolves it to the parent's icon when unset. This
    #: is the level the technician app actually draws — its coverage grid is one
    #: tile per subcategory — so a Television and an Air Conditioner under the
    #: same "Electric" category still need different glyphs.
    icon_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("ix_product_subcategories_category_id", "category_id"),
        Index("ix_product_subcategories_company_id", "company_id"),
        UniqueConstraint(
            "company_id", "id", name="uq_product_subcategories_company_id_id"
        ),
        # Composite, not a plain category_id FK: the pair has to match, so a
        # subcategory under another company's category cannot be written at
        # all — not by a race, not by a future refactor that forgets the check.
        ForeignKeyConstraint(
            ["company_id", "category_id"],
            ["product_categories.company_id", "product_categories.id"],
            name="fk_product_subcategories_company_category",
            ondelete="CASCADE",
        ),
    )


class ProductModel(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    """Bottom level, e.g. 43" 4K UHD. The thing a ticket names.

    `image_urls` holds http(s) URLs into blob storage and the schema layer
    rejects `data:` — both consoles can produce base64 from a crop, and letting
    one in would put tens of kilobytes into every list response.
    """

    __tablename__ = "product_models"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: The FK is COMPOSITE, declared in __table_args__ — see there.
    subcategory_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: The brand. Mandatory: a model nobody makes is not a model anybody can be
    #: sent to install. Also a COMPOSITE FK — see __table_args__.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Size or rating — "43 inch", "7 kg", "340 L". Its own column rather than
    #: part of the name, which is where it lives today and where it cannot be
    #: sorted, filtered or shown on its own.
    capacity: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: What a technician gets asked in front of the unit, and what a later
    #: claim quotes. CHECK 0..240 in the migration.
    warranty_months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    #: Up to five photos, ordered — the first is the thumbnail every list draws.
    #: JSONB rather than a child table: the list is bounded, always read whole
    #: with its model and never queried on its own, so a join would buy nothing
    #: and cost a second composite-FK relationship to keep tenant-safe. The
    #: ceiling is enforced in the schema layer, not by a CHECK.
    #:
    #: Assign a NEW list to change it. SQLAlchemy does not track mutation of a
    #: plain JSONB value in place, so `row.image_urls.append(...)` saves nothing.
    image_urls: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("ix_product_models_subcategory_id", "subcategory_id"),
        Index("ix_product_models_company_id", "company_id"),
        Index("ix_product_models_vendor_id", "vendor_id"),
        ForeignKeyConstraint(
            ["company_id", "subcategory_id"],
            ["product_subcategories.company_id", "product_subcategories.id"],
            name="fk_product_models_company_subcategory",
            ondelete="CASCADE",
        ),
        # RESTRICT, not CASCADE: removing a vendor that still brands models must
        # be refused with a message the user can act on, never take the models
        # down with it. Same reasoning as technician_subcategories' subcategory
        # side, which refuses to silently decertify somebody.
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_product_models_company_vendor",
            ondelete="RESTRICT",
        ),
    )
