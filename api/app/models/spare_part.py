"""Spare parts: what a technician may ask for, and every request's log.

`spare_parts` is a catalogue keyed on the PRODUCT MASTER — a category node or
one product model — and inherited down the tree (P1). `spare_part_requests` is
the facility's log of one request: who asked, who decided, who handed the new
part over, who took the old one back (P4, P5). No money and no stock counts.
"""

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin

PART_REQUEST_STATUSES = ("requested", "approved", "rejected", "issued", "returned")
#: The two statuses that keep a job in `Awaiting Part` and refuse Complete.
OPEN_PART_REQUEST_STATUSES = ("requested", "approved")


class SparePart(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "spare_parts"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: Exactly one of these two (CHECK `one_owner`). A node's parts are inherited
    #: by every node and product beneath it; a model's are its own.
    node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Off = not offered. Deeper and off HIDES the same name inherited from above.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        CheckConstraint("(node_id IS NULL) <> (model_id IS NULL)", name="one_owner"),
        CheckConstraint("length(btrim(name)) BETWEEN 1 AND 120", name="name"),
        # FK target for spare_part_requests. TOTAL — a partial index cannot be one.
        UniqueConstraint("company_id", "id", name="uq_spare_parts_company_id_id"),
        ForeignKeyConstraint(
            ["company_id", "node_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_spare_parts_company_node",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "model_id"],
            ["product_models.company_id", "product_models.id"],
            name="fk_spare_parts_company_model",
            ondelete="RESTRICT",
        ),
        # Covering indexes for the two FKs. NOT the partial uniques below: a
        # RESTRICT check must also see soft-deleted rows, which a partial index
        # on `deleted_at IS NULL` cannot serve.
        Index("ix_spare_parts_company_node", "company_id", "node_id"),
        Index("ix_spare_parts_company_model", "company_id", "model_id"),
        # uq_spare_parts_node_name / uq_spare_parts_model_name are hand-written
        # lower(btrim(name)) partial indexes in the migration — autogenerate will
        # offer to drop them on every future revision (hard rule 8): delete that drop.
    )


class SparePartRequest(Base, IdMixin, AuditMixin):
    """One technician's request for one part on one job. Never deleted — a log.

    No SoftDeleteMixin: this is the evidence that a part left the store and
    whether its broken twin came back. `*_by_user_id` carry no FK (users are
    global and may be removed; the ActorMixin reason) and `*_by_label` freeze
    the name as it was, like `ticket_events.actor_label`.
    """

    __tablename__ = "spare_part_requests"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: `RGT-SPR-0007` — core.sequences series "spare_part_request".
    code: Mapped[str] = mapped_column(String(24), nullable=False)
    #: The TICKET's franchisee at raise time (D2). The facility wall.
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: Exactly one of these two (CHECK `one_part`). An Other request linked to
    #: the catalogue on approval (P7) swaps other_name for spare_part_id.
    spare_part_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    other_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: What was asked for, frozen: renaming the catalogue row never rewrites it.
    part_name: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'requested'")
    )

    decided_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    decided_by_label: Mapped[str | None] = mapped_column(String(120))
    #: 255 because it is quoted into notifications.detail (255) and a push.
    reject_reason: Mapped[str | None] = mapped_column(String(255))
    #: Owner ruling 2026-10-15 (R2): which status a rejection came from —
    #: 'requested' (declined) or 'approved' (cancelled after approval). NULL
    #: unless status = 'rejected'. When rejected from 'approved', decided_* are
    #: OVERWRITTEN with the rejecting person and time (the approval stays in the
    #: part_approved event).
    rejected_from: Mapped[str | None] = mapped_column(String(16), nullable=True)
    issued_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    issued_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    issued_by_label: Mapped[str | None] = mapped_column(String(120))
    issue_note: Mapped[str | None] = mapped_column(String(500))
    returned_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    returned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    returned_by_label: Mapped[str | None] = mapped_column(String(120))
    return_note: Mapped[str | None] = mapped_column(String(500))
    #: `attachment/<company_id>/<uuid>.jpg` in the PRIVATE container — a blob
    #: NAME, never a URL; signed per read (`integrations/blob.signed_url`).
    return_photo_blob_name: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (
        CheckConstraint(
            "status IN ('requested', 'approved', 'rejected', 'issued', 'returned')",
            name="status",
        ),
        CheckConstraint(
            "(spare_part_id IS NULL) <> (other_name IS NULL)", name="one_part"
        ),
        # The state machine, made structural: a row cannot claim a step it has
        # no record of. Each reads "this status <=> that column is set".
        CheckConstraint(
            "(status = 'requested') = (decided_at IS NULL)",
            name="decided_matches_status",
        ),
        CheckConstraint(
            "(decided_at IS NULL) = (decided_by_label IS NULL)", name="decided_by_both"
        ),
        CheckConstraint(
            "(status = 'rejected') = (reject_reason IS NOT NULL)",
            name="rejected_has_reason",
        ),
        # owner ruling 2026-10-15 (R2): a rejection says where it came from.
        CheckConstraint(
            "(status = 'rejected') = (rejected_from IS NOT NULL) "
            "AND (rejected_from IS NULL OR rejected_from IN ('requested', 'approved'))",
            name="rejected_from_matches_status",
        ),
        CheckConstraint(
            "(status IN ('issued', 'returned')) = (issued_at IS NOT NULL)",
            name="issued_matches_status",
        ),
        CheckConstraint(
            "(status = 'returned') = (returned_at IS NOT NULL)",
            name="returned_matches_status",
        ),
        CheckConstraint(
            "return_photo_blob_name IS NULL OR status = 'returned'",
            name="photo_only_when_returned",
        ),
        # TOTAL, like uq_tickets_company_code: a code read out on the phone is
        # never reused.
        UniqueConstraint("company_id", "code", name="uq_spare_part_requests_company_code"),
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_spare_part_requests_company_franchisee",
            ondelete="RESTRICT",
        ),
        # CASCADE like ticket_events: the history of a deleted ticket has
        # nothing left to describe.
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_spare_part_requests_company_ticket",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_spare_part_requests_company_technician",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "spare_part_id"],
            ["spare_parts.company_id", "spare_parts.id"],
            name="fk_spare_part_requests_company_part",
            ondelete="RESTRICT",
        ),
        # The facility queue (franchisee + status, oldest first) AND the FK cover.
        Index(
            "ix_spare_part_requests_queue",
            "company_id", "franchisee_id", "status", "created_at",
        ),
        # One ticket's requests — the job screen, the ticket page, the recompute.
        Index(
            "ix_spare_part_requests_company_ticket",
            "company_id", "ticket_id", "created_at",
        ),
        Index("ix_spare_part_requests_company_technician", "company_id", "technician_id"),
        Index("ix_spare_part_requests_company_part", "company_id", "spare_part_id"),
        # uq_spare_part_requests_open_name — hand-written partial lower() index (D3).
    )
