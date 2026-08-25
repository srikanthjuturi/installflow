"""Tickets — a customer needs something done to a product, at a time.

The unit of work the whole system exists to move: raised here, a slot agreed
with the customer, offered to eligible technicians, accepted, done, proved, and
closed.

Everything it points at is stored by ID, never by name. The mock stored
`vendor: "Reliance GreenTech"` and `product: '43" 4K UHD'` as strings, which meant
renaming anything in the product master silently orphaned every ticket that had
referenced it. The API resolves names on read instead.

`sla_due_at` is stored rather than derived because the list sorts and filters on
SLA urgency, and that has to happen in SQL — computing it per row in Python
would make the page's `total` disagree with the rows on it.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
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
    #:
    #: REQUIRED. It was nullable while ops raised tickets, because they often
    #: did not have it and blocking a ticket over a number nobody could see
    #: helped no one. That reason expired when the VENDOR became the one raising
    #: them: the vendor holds the invoice, so it is knowable at intake — and the
    #: AI check now always has something to compare the photographed serial
    #: against, which is the entire point of capturing it.
    #:
    #: NOT unique. A service call on a unit installed earlier legitimately
    #: repeats the serial, and uniqueness would refuse the second ticket on the
    #: same appliance.
    serial_number: Mapped[str] = mapped_column(String(64), nullable=False)

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

    #: Which intake channel produced this ticket: 'Manual', 'Excel' or 'API' —
    #: the same three words a vendor declares in `intake_channels`.
    #:
    #: Only 'Manual' is written today. It is recorded from the start anyway,
    #: because the alternative is adding the column once bulk upload exists and
    #: having to guess retrospectively what every earlier row came in through.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'Manual'")
    )

    # ── when ───────────────────────────────────────────────────────────────
    #: What ops were asked for — the vendor's or the customer's target day, set
    #: at intake. NOT a promise, and deliberately NOT constrained to agree with
    #: `slot_start`: the customer picks from the windows the service level
    #: allows, and if they choose a different day that is their answer, not a
    #: contradiction. The gap between the two is a number worth reporting on
    #: later; collapsing them into one column would destroy it.
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

    #: What the technician actually READ on site — scanned off the barcode, or
    #: typed in when it would not scan.
    #:
    #: `serial_number` above is the EXPECTED one, off the vendor's invoice. This
    #: is the observed one, and the gap between them is the whole point of
    #: capturing it: a mismatch means the wrong unit, a relabelled box, or —
    #: far more often — a transcription slip at intake.
    #:
    #: Null until proof is submitted. Never overwrites `serial_number`: a
    #: correction is a deliberate act by the vendor or a manager, recorded as a
    #: ticket event, not something a scan does silently.
    observed_serial: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: `scanned` | `manual`. A number a machine read and a number a person typed
    #: are different evidence, and only one of them can contain a typo.
    observed_serial_source: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )

    # ── closing it: the CUSTOMER's word, not the technician's ──────────────
    #
    # A technician saying "done" is a claim. These columns hold the only thing
    # that settles it. Deliberately parallel to the slot_* set above, because it
    # is the same mechanism pointed at a different question — one link, one
    # customer, one answer.
    #
    #: Minted when the technician marks the work complete. Null until then, and
    #: never nulled afterwards: `customer_confirmed_at` is what makes it
    #: single-use, exactly as `slot_confirmed_at` does for the slot token.
    feedback_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Delivery of the feedback request: pending | sent | failed | not_needed.
    feedback_request_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'not_needed'")
    )
    feedback_request_error: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    #: 1–5. Null means they have not answered, which is a different claim from a
    #: bad score — the same reason `technician_profiles.rating` is nullable.
    customer_rating: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    #: Their own words, optional. Kept even when they say the job was NOT done —
    #: especially then, since that is the version somebody will argue about.
    customer_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: When they answered, either way. Burns the token.
    customer_confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── where it has got to ────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    #: Set on first-accept. Composite FK; RESTRICT, so a technician who has held
    #: a ticket cannot be hard-deleted out from under its history.
    technician_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    __table_args__ = (
        # Declared on the MODEL, not only in a migration, so the model is the
        # whole truth about the table and `--autogenerate` can see them.
        CheckConstraint(
            "service_level_hours IN (12, 24, 36, 48)", name="service_level_hours"
        ),
        CheckConstraint(
            "service_type IN ('Installation + Demo', 'Tech Visit', 'Service')",
            name="service_type",
        ),
        CheckConstraint(
            "status IN ('New', 'Slot Pending', 'Assigned', 'In Progress', "
            "'Awaiting Customer', 'AI Review', 'Escalated', 'Closed', "
            "'Force-Closed', 'Cancelled')",
            name="status",
        ),
        CheckConstraint(
            "customer_rating IS NULL OR customer_rating BETWEEN 1 AND 5",
            name="customer_rating",
        ),
        CheckConstraint(
            "observed_serial_source IS NULL OR "
            "observed_serial_source IN ('scanned', 'manual')",
            name="observed_serial_source",
        ),
        CheckConstraint(
            "feedback_request_status IN ('not_needed', 'pending', 'sent', 'failed')",
            name="feedback_request_status",
        ),
        CheckConstraint(
            "slot_request_status IN ('not_needed', 'pending', 'sent', 'failed')",
            name="slot_request_status",
        ),
        CheckConstraint("source IN ('API', 'Excel', 'Manual')", name="source"),
        # The description rule, as a backstop. It is validated in `schemas.py`
        # too, where it can give a per-field message; this is here so the table
        # describes itself and so a future importer that bypasses the request
        # schema cannot write a Service ticket with no fault on it.
        #
        # Reads as "exactly one of the two is true", which works only because
        # `service_type` is already constrained to three values above.
        CheckConstraint(
            "(service_type = 'Installation + Demo') = (description IS NULL)",
            name="description_required",
        ),
        # Half a slot is not a time.
        CheckConstraint(
            "(slot_start IS NULL) = (slot_end IS NULL) "
            "AND (slot_end IS NULL OR slot_end > slot_start)",
            name="slot_both_or_neither",
        ),
        # TOTAL on purpose, unlike the other soft-delete uniques: a ticket
        # number must never be reused, or a deleted ticket and a live one share
        # an identifier in somebody's email thread.
        UniqueConstraint("company_id", "code", name="uq_tickets_company_code"),
        # What `ticket_events` composite FK points at, so an event physically
        # cannot be attached to another company's ticket. TOTAL, like every
        # other FK target — a partial index cannot be one.
        UniqueConstraint("company_id", "id", name="uq_tickets_company_id_id"),
        # NB `slot_token` has no UniqueConstraint here. It is unique globally —
        # the token IS the URL and is resolved before any company is known — but
        # as a PARTIAL index on `slot_token IS NOT NULL`, written by hand in the
        # migration. Declaring it here as well would collide on the name.
        Index("ix_tickets_company_status", "company_id", "status"),
        # The routing probe: "which tickets are in this pincode" is asked by
        # every area manager on every page load.
        Index("ix_tickets_company_pincode", "company_id", "pincode"),
        Index("ix_tickets_company_sla_due_at", "company_id", "sla_due_at"),
        Index("ix_tickets_technician_id", "technician_id"),
        # One per composite FK below. Without these, deleting a vendor — or a
        # model, or a subcategory — seq-scans every ticket in the database to
        # prove the RESTRICT holds, and "tickets for this vendor" does the same.
        Index("ix_tickets_company_vendor", "company_id", "vendor_id"),
        Index("ix_tickets_company_subcategory", "company_id", "subcategory_id"),
        Index("ix_tickets_company_model", "company_id", "model_id"),
        Index("ix_tickets_company_technician", "company_id", "technician_id"),
        # A vendor USER's list is "my vendor, and raised by me". `created_by`
        # comes from ActorMixin as a plain UUID with no foreign key, so the
        # FK-coverage query that catches this class of miss would never ask for
        # it — and without it every page of that list is a sequential scan.
        Index("ix_tickets_created_by", "created_by"),
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


class TicketProof(Base, IdMixin, AuditMixin):
    """One artifact a technician captured on site.

    A row per photo rather than four columns on `tickets`, because `photos` is
    one to four shots and the other three are one each — a column set would
    either cap product photos at one or invent `photo_1_url` through
    `photo_4_url`, and both are the shape that has to be undone later.

    No `SoftDeleteMixin`. Proof is evidence: a retake is a NEW row with a higher
    `ordinal`, and the superseded one stays. What the technician photographed
    first is exactly what somebody disputing the job will want to see.

    **`blob_name`, not a URL.** These images live in a PRIVATE container and are
    served through short-lived signed links, so a stored URL would embed a token
    that expires — the row would rot while the image was still there. The name
    is stable; the link is minted per read (`app/integrations/blob.py`).
    """

    __tablename__ = "ticket_proofs"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: Composite FK in __table_args__ — one company's proof must never be able
    #: to attach to another company's ticket.
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Position within its kind. Always 1 for the three single-shot kinds; 1..4
    #: for `photos`, in the order they were taken.
    ordinal: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    blob_name: Mapped[str] = mapped_column(String(255), nullable=False)
    #: The phone's clock at the shutter. Not the server's: the gap between them
    #: is itself worth seeing, and a technician offline for an hour still has a
    #: true capture time.
    captured_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    #: Where the phone was. Set on the `live` capture and null everywhere else —
    #: the geo-tag is what evidences attendance, and only that shot claims it.
    #: Null on a live shot means the technician denied or lost location, which
    #: is a fact worth keeping rather than a reason to refuse the upload.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Metres. A fix accurate to 2km is not the same evidence as one to 5m.
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: The postal code the DEVICE was in, reverse-geocoded on the phone from the
    #: coordinates beside it.
    #:
    #: Stored because it is what the rule is enforced on — a live photo whose
    #: device pincode disagrees with the ticket's is refused — and because
    #: recomputing it later would need a geocoding service this deployment does
    #: not have. The COORDINATES remain the evidence; this is a claim the client
    #: made about them, kept so the two can be compared afterwards.
    #:
    #: Null when reverse geocoding failed while the fix itself was good. That is
    #: accepted: refusing it would strand a technician standing at the right
    #: door with a working GPS and no map data.
    device_pincode: Mapped[str | None] = mapped_column(String(6), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('barcode', 'serial', 'photos', 'live')", name="kind"
        ),
        CheckConstraint("ordinal BETWEEN 1 AND 4", name="ordinal"),
        # The only query this table serves: one ticket's proof, in capture
        # order. Also the covering index the composite FK needs — Postgres
        # creates none, and without it deleting a ticket scans the whole table.
        Index(
            "ix_ticket_proofs_company_ticket",
            "company_id",
            "ticket_id",
            "captured_at",
        ),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ticket_proofs_company_ticket",
            ondelete="CASCADE",
        ),
    )
