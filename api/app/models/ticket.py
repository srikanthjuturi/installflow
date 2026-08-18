"""Tickets — a customer needs something done to a product, at a time.

The unit of work the whole system exists to move: raised here, a slot agreed
with the customer, offered to eligible technicians, accepted, done, proved, and
closed.

Everything it points at is stored by ID, never by name. The mock stored
`vendor: "Videocon"` and `product: '43" 4K UHD'` as strings, which meant
renaming anything in the product master silently orphaned every ticket that had
referenced it. The API resolves names on read instead.

`sla_due_at` is stored rather than derived because the list sorts and filters on
SLA urgency, and that has to happen in SQL — computing it per row in Python
would make the page's `total` disagree with the rows on it.
"""

import datetime
import uuid

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin


class Ticket(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "tickets"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: `INST-240912`. Human-facing: it is the route param, what ops quote on the
    #: phone, and what the ledger and AI queue key on.
    code: Mapped[str] = mapped_column(String(24), nullable=False)

    # ── what, and whose ────────────────────────────────────────────────────
    #: All three are COMPOSITE FKs — see __table_args__.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    subcategory_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    model_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: One of `app.core.service_types.SERVICE_TYPES`, and it must be one the
    #: chosen model DECLARES it supports — checked in the service, because the
    #: database cannot see into another row's JSONB array.
    service_type: Mapped[str] = mapped_column(String(32), nullable=False)
    #: The customer's problem, in their words. Required for Tech Visit and
    #: Service; refused for Installation + Demo, which explains itself.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: The EXPECTED serial — off the invoice or delivery note, entered at
    #: intake. Not the one the technician photographs on site: that is read by
    #: the AI at proof time, and a mismatch between the two is the whole point.
    #: Nullable because ops often will not have it, and blocking a ticket over a
    #: number nobody can see yet helps no one. Absent simply means the AI
    #: compares the product model only, which is what the requirement document
    #: describes anyway.
    serial_number: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # ── who, and where ─────────────────────────────────────────────────────
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    #: E.164. Masked from technicians until they accept.
    customer_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    #: The street line. Also masked until accept — the technician sees only the
    #: area and pincode while deciding whether to take the job.
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Everything routes on this: technician eligibility, area-manager
    #: visibility, and the geo-check on the proof photo.
    pincode: Mapped[str] = mapped_column(String(6), nullable=False)

    # ── when ───────────────────────────────────────────────────────────────
    expected_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    #: 12 / 24 / 36 / 48. The slot must START within this long of creation.
    service_level_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: The customer-confirmed slot. Both null until somebody agrees a time; a
    #: CHECK keeps them both-or-neither, because half a slot is not a time.
    slot_start: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    slot_end: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: `created_at + service_level_hours`. Stored, not derived — see the module
    #: docstring.
    sla_due_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # ── the customer's slot confirmation ───────────────────────────────────
    #: 256 bits, in the WhatsApp link the customer taps to pick a time.
    #:
    #: Stored in clear, deliberately and for the same reasons as the technician
    #: invite token: the console shows a copyable link when WhatsApp refuses,
    #: and a resend has to send the SAME one. Neither is possible against a
    #: hash. Single use and an expiry that tracks the SLA window are the
    #: mitigations, and what it protects is a two-hour appointment rather than
    #: an account.
    #:
    #: Null when ops entered the slot themselves — nothing to ask.
    slot_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: When the customer picked. Null while it is still their turn, and what
    #: makes the token single-use.
    slot_confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Delivery of the slot REQUEST: pending | sent | failed | not_needed.
    #: A refusal is recorded, never raised — the ticket exists either way, and
    #: ops can resend or read the slot out over the phone.
    slot_request_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'not_needed'")
    )
    #: Meta's own words when it refused. Shown to ops verbatim.
    slot_request_error: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── where it has got to ────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    #: Set on first-accept. Composite FK; RESTRICT, so a technician who has held
    #: a ticket cannot be hard-deleted out from under its history.
    technician_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_tickets_company_code"),
        # Global, not per company: the token IS the URL, and it is resolved
        # before any company is known. Partial on NOT NULL in the migration, so
        # the many tickets ops slotted themselves do not collide on null.
        UniqueConstraint("slot_token", name="uq_tickets_slot_token"),
        Index("ix_tickets_company_status", "company_id", "status"),
        # The routing probe: "which tickets are in this pincode" is asked by
        # every area manager on every page load.
        Index("ix_tickets_company_pincode", "company_id", "pincode"),
        Index("ix_tickets_company_sla_due_at", "company_id", "sla_due_at"),
        Index("ix_tickets_technician_id", "technician_id"),
        # RESTRICT on all three masters: a vendor, subcategory or model a ticket
        # names must not be able to disappear from under it. The services
        # already refuse to delete one that is referenced; this is the backstop.
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_tickets_company_vendor",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "subcategory_id"],
            ["product_subcategories.company_id", "product_subcategories.id"],
            name="fk_tickets_company_subcategory",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "model_id"],
            ["product_models.company_id", "product_models.id"],
            name="fk_tickets_company_model",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_tickets_company_technician",
            ondelete="RESTRICT",
        ),
    )
