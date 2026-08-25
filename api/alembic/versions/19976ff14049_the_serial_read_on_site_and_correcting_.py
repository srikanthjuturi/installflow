"""the serial read on site, and correcting the one on the order

Two columns and two new event kinds.

`tickets.serial_number` is the EXPECTED serial, typed at intake from the
vendor's invoice. Nothing until now recorded what the technician actually found
on the unit, so a mismatch between the order and reality was invisible.

The `kind` CHECK on `ticket_events` is replaced rather than added to — Alembic
reflects it but cannot edit one. Its fourteen proposed `drop_index` calls
against every hand-written functional and partial index have been deleted, as
in every migration before this.

Revision ID: 19976ff14049
Revises: 01c5edc55c4e
Create Date: 2026-08-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "19976ff14049"
down_revision: Union[str, Sequence[str], None] = "01c5edc55c4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_OLD = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed', 'assigned', 'started', "
    "'feedback_requested', 'completed', 'feedback_received', 'reopened')"
)
_KINDS_NEW = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed', 'assigned', 'started', "
    "'feedback_requested', 'completed', 'feedback_received', 'reopened', "
    "'serial_mismatch', 'serial_corrected')"
)


def upgrade() -> None:
    op.add_column(
        "tickets", sa.Column("observed_serial", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "tickets",
        sa.Column("observed_serial_source", sa.String(length=16), nullable=True),
    )
    op.create_check_constraint(
        "observed_serial_source",
        "tickets",
        "observed_serial_source IS NULL OR "
        "observed_serial_source IN ('scanned', 'manual')",
    )

    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _KINDS_NEW)


def downgrade() -> None:
    # Real records of real readings; the old CHECK cannot hold them.
    op.execute(
        "DELETE FROM ticket_events WHERE kind IN "
        "('serial_mismatch', 'serial_corrected')"
    )
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _KINDS_OLD)

    # Bare name — the naming convention adds the `ck_tickets_` prefix.
    op.drop_constraint("observed_serial_source", "tickets", type_="check")
    op.drop_column("tickets", "observed_serial_source")
    op.drop_column("tickets", "observed_serial")
