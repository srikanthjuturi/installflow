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
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
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

    #: How this vendor's tickets reach us — one or more of
    #: `app.core.intake.INTAKE_CHANNELS`, in the order they were picked.
    #:
    #: JSONB rather than a child table, for the same reason as
    #: `ProductModel.image_urls`: the list is bounded at three, always read
    #: whole with its vendor, and never queried on its own — a join would buy
    #: nothing and cost a second composite-FK relationship to keep tenant-safe.
    #: Membership and "at least one" are a CHECK in the migration; which of them
    #: may be SELECTED today is a schema-layer rule, because that changes when
    #: the API push endpoint ships and should not need a migration.
    #:
    #: Assign a NEW list to change it. SQLAlchemy does not track mutation of a
    #: plain JSONB value in place, so `row.intake_channels.append(...)` saves
    #: nothing.
    intake_channels: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[\"Manual\"]'::jsonb")
    )

    # Statutory identity. Entered by hand today, like companies.
    gst_number: Mapped[str] = mapped_column(String(15), nullable=False)
    #: The holder's PAN — the same ten characters that sit inside `gst_number`,
    #: which is where `d3f27a8c1904` backfilled it from.
    #:
    #: Nullable, unlike `companies.pan`, only because it arrived after the
    #: vendors did. It is knowable for every row by construction, so treat a
    #: NULL as "not filled in yet", never as "this vendor has none".
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True)
    #: The registration's standing at the GST portal — "Active", "Cancelled".
    #: Same fact `companies.gst_company_status` records about the tenant.
    #:
    #: Nullable because nothing can know it yet: it comes back with the GSTIN
    #: lookup, which does not exist. NULL means "never looked up" and renders as
    #: nothing — inventing "Active" here would be asserting a registration is
    #: live on no evidence at all.
    gst_company_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
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

    #: Whether this vendor's portal offers the Google-backed address search on
    #: the ticket form. Off means they type the address in by hand, which is the
    #: same path taken when no Maps key is configured at all.
    #:
    #: Named for the CAPABILITY, not the provider — swapping Places for another
    #: geocoder must not be a migration.
    #:
    #: Defaults ON, unlike a metered capability's usual instinct, because
    #: switching it off costs more than money: coordinates reach a ticket only
    #: from a picked search result, and `jobs.service` verifies a technician's
    #: live photo by DISTANCE only when the ticket has them. An off vendor's
    #: jobs fall back to comparing pincodes, which can span kilometres.
    #:
    #: It is a UI capability, not a spend control. The Maps key ships in the
    #: client bundle by design, so this hides the box rather than closing the
    #: door. Capping spend is a per-key quota in Google Cloud.
    address_search_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(intake_channels) = 'array' "
            "AND jsonb_array_length(intake_channels) >= 1 "
            "AND intake_channels <@ '[\"API\", \"Excel\", \"Manual\"]'::jsonb",
            name="intake_channels",
        ),
        Index("ix_vendors_company_id", "company_id"),
        # What product_models' composite FK points at, so a model physically
        # cannot be branded with another company's vendor.
        UniqueConstraint("company_id", "id", name="uq_vendors_company_id_id"),
    )
