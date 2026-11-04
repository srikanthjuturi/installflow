"""Where a ticket's point came from, and a history entry for setting it

Adds `tickets.location_source` ('vendor' | 'customer' | 'staff') and
`tickets.location_set_at`, and widens the `ticket_events.kind` CHECK with
`location_set`. The point itself is the existing `latitude` / `longitude`,
which the travel allowance and the live-photo check already read.

Backfill: a ticket that already has a point can only have got it from the
vendor's address search (nothing else ever wrote one), so those rows are
stamped `vendor` with their creation time. A ticket with no point stays NULL —
that is the true statement "nobody supplied one", never to be guessed.

Hand-written, like its siblings: autogenerate would try to drop the
hand-written partial indexes (`uq_tickets_vendor_external_ref`, the
`slot_token` index), which Alembic does not recognise.

Revision ID: e5b81c3d9a27
Revises: b7c3f0a5d9e1
Create Date: 2026-11-04

NOTE: stacked on `b7c3f0a5d9e1`, the head the development database is on, and
NOT on `d4f8a21b9c56` — that migration is held back until the duplicate
serials are resolved (see the note in `b7c3f0a5d9e1`). The two heads are still
unmerged; migrate to this revision by id, never `head`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5b81c3d9a27"
down_revision: Union[str, Sequence[str], None] = "b7c3f0a5d9e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_OLD = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed', 'assigned', 'started', "
    "'feedback_requested', 'completed', 'feedback_received', "
    "'reopened', 'serial_mismatch', 'serial_corrected', 'reminded', "
    "'customer_notified', 'escalated', 'bonus_added', 'released', "
    "'no_show', 'force_closed', 'rescheduled', 'penalty_reversed', "
    "'franchisee_changed', 'speed_settled', 'part_requested', "
    "'part_approved', 'part_rejected', 'part_issued', 'part_returned')"
)
_KINDS_NEW = _KINDS_OLD.replace("'part_returned')", "'part_returned', 'location_set')")


def upgrade() -> None:
    op.add_column(
        "tickets", sa.Column("location_source", sa.String(16), nullable=True)
    )
    op.add_column(
        "tickets",
        sa.Column("location_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE tickets SET location_source = 'vendor', location_set_at = created_at "
        "WHERE latitude IS NOT NULL"
    )
    # Bare names — the naming convention adds `ck_<table>_`.
    op.create_check_constraint(
        "location_source",
        "tickets",
        "location_source IS NULL OR location_source IN ('vendor', 'customer', 'staff')",
    )
    op.create_check_constraint(
        "location_point",
        "tickets",
        "(location_source IS NULL) = (latitude IS NULL) "
        "AND (location_source IS NULL) = (location_set_at IS NULL)",
    )

    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _KINDS_NEW)


def downgrade() -> None:
    # Real records of real saves, but the constraint they violate is the
    # statement that they should not exist once this revision is gone.
    op.execute("DELETE FROM ticket_events WHERE kind = 'location_set'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _KINDS_OLD)

    op.drop_constraint("location_point", "tickets", type_="check")
    op.drop_constraint("location_source", "tickets", type_="check")
    op.drop_column("tickets", "location_set_at")
    op.drop_column("tickets", "location_source")
