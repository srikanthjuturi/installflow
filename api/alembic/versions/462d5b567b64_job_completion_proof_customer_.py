"""job completion: proof, customer confirmation, awaiting-customer

Adds the second half of a job's life: the evidence a technician captures on
site, and the customer's answer that closes the ticket.

Three things here autogenerate could not do, and one it should not:

  * the `kind` CHECK on `ticket_events` and the `status` CHECK on `tickets` are
    REPLACED, not added — Alembic reflects them but has no notion of editing
    one, so both are dropped and recreated. Precedent: `e2a740c1b358`.
  * the partial unique index on `feedback_token` is hand-written. Alembic
    cannot see a partial index and WILL offer to drop it on the next revision;
    delete that drop when it appears, exactly as with `ix_tickets_pool`.
  * fourteen `drop_index` calls against every `LOWER()` functional index and
    every partial index in the schema have been deleted from this file. They
    are not stale — dropping them would silently remove the uniqueness that
    stops two companies sharing a slug.

Revision ID: 462d5b567b64
Revises: c5c9299d0ecb
Create Date: 2026-08-25 11:56:04.432048

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "462d5b567b64"
down_revision: Union[str, Sequence[str], None] = "c5c9299d0ecb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Bare names on both sides — the naming convention adds `ck_<table>_`.
_EVENT_KINDS_OLD = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed', 'assigned')"
)
_EVENT_KINDS_NEW = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed', 'assigned', 'started', "
    "'feedback_requested', 'completed', 'feedback_received', 'reopened')"
)

_STATUS_OLD = (
    "status IN ('New', 'Slot Pending', 'Assigned', 'In Progress', "
    "'AI Review', 'Escalated', 'Closed', 'Force-Closed', 'Cancelled')"
)
_STATUS_NEW = (
    "status IN ('New', 'Slot Pending', 'Assigned', 'In Progress', "
    "'Awaiting Customer', 'AI Review', 'Escalated', 'Closed', "
    "'Force-Closed', 'Cancelled')"
)

_NEW_EVENT_KINDS = (
    "'started', 'feedback_requested', 'completed', 'feedback_received', 'reopened'"
)


def upgrade() -> None:
    # ── the evidence ─────────────────────────────────────────────────────────
    op.create_table(
        "ticket_proofs",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("ordinal", sa.SmallInteger(), nullable=False),
        sa.Column("blob_name", sa.String(length=255), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('barcode', 'serial', 'photos', 'live')",
            name=op.f("ck_ticket_proofs_kind"),
        ),
        sa.CheckConstraint(
            "ordinal BETWEEN 1 AND 4", name=op.f("ck_ticket_proofs_ordinal")
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ticket_proofs_company_ticket",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_ticket_proofs_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_proofs")),
    )
    # Covers the composite FK as well as the read. Postgres creates no index for
    # a foreign key, so without this deleting a ticket scans the whole table.
    op.create_index(
        "ix_ticket_proofs_company_ticket",
        "ticket_proofs",
        ["company_id", "ticket_id", "captured_at"],
        unique=False,
    )

    # ── the customer's answer ────────────────────────────────────────────────
    op.add_column(
        "tickets", sa.Column("feedback_token", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "tickets",
        sa.Column(
            "feedback_request_status",
            sa.String(length=16),
            server_default=sa.text("'not_needed'"),
            nullable=False,
        ),
    )
    op.add_column(
        "tickets",
        sa.Column("feedback_request_error", sa.String(length=255), nullable=True),
    )
    op.add_column("tickets", sa.Column("customer_rating", sa.SmallInteger(), nullable=True))
    op.add_column("tickets", sa.Column("customer_feedback", sa.Text(), nullable=True))
    op.add_column(
        "tickets",
        sa.Column("customer_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "customer_rating",
        "tickets",
        "customer_rating IS NULL OR customer_rating BETWEEN 1 AND 5",
    )
    op.create_check_constraint(
        "feedback_request_status",
        "tickets",
        "feedback_request_status IN ('not_needed', 'pending', 'sent', 'failed')",
    )
    # Partial, because only a completed ticket has a token and NULLs must not
    # collide. Hand-written: Alembic cannot express or reflect this.
    op.execute(
        "CREATE UNIQUE INDEX uq_tickets_feedback_token ON tickets (feedback_token) "
        "WHERE feedback_token IS NOT NULL"
    )

    # ── vocabularies ─────────────────────────────────────────────────────────
    op.drop_constraint("status", "tickets", type_="check")
    op.create_check_constraint("status", "tickets", _STATUS_NEW)

    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _EVENT_KINDS_NEW)


def downgrade() -> None:
    # Events of the new kinds cannot satisfy the old CHECK, and they are real
    # records of real work: drop them rather than fail the migration. Same
    # trade as `e2a740c1b358`.
    op.execute(f"DELETE FROM ticket_events WHERE kind IN ({_NEW_EVENT_KINDS})")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _EVENT_KINDS_OLD)

    # Same for the status: anything parked in Awaiting Customer goes back to
    # In Progress, which is where it was a moment before and is still true —
    # the work is done but the ticket is not closed.
    op.execute(
        "UPDATE tickets SET status = 'In Progress' WHERE status = 'Awaiting Customer'"
    )
    op.drop_constraint("status", "tickets", type_="check")
    op.create_check_constraint("status", "tickets", _STATUS_OLD)

    op.execute("DROP INDEX IF EXISTS uq_tickets_feedback_token")
    # Bare names, like the creates above. The naming convention prefixes
    # `ck_tickets_`; passing the full name gets it prefixed a second time.
    op.drop_constraint("feedback_request_status", "tickets", type_="check")
    op.drop_constraint("customer_rating", "tickets", type_="check")
    op.drop_column("tickets", "customer_confirmed_at")
    op.drop_column("tickets", "customer_feedback")
    op.drop_column("tickets", "customer_rating")
    op.drop_column("tickets", "feedback_request_error")
    op.drop_column("tickets", "feedback_request_status")
    op.drop_column("tickets", "feedback_token")

    op.drop_index("ix_ticket_proofs_company_ticket", table_name="ticket_proofs")
    op.drop_table("ticket_proofs")
