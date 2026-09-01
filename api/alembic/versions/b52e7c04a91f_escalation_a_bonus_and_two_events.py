"""escalation: a bonus, and the two events that spend it

Revision ID: b52e7c04a91f
Revises: e6b40d92c7a5
Create Date: 2026-08-31 15:10:44.812004

Nobody accepting a job used to raise a notification and change nothing. It now
moves the ticket to `Escalated`, which takes it OUT of the pool and makes it a
manager's problem — and the manager's two ways out both need storage the schema
did not have.

  * `tickets.bonus_paise` — what a manager attached to a re-notification.
    The first paise column in this schema. NULL means no bonus was ever funded,
    which is a different claim from ₹0, so the CHECK is `> 0` rather than
    `>= 0`: two ways to say "no bonus" is one too many.
  * `ticket_events.kind` gains `escalated` and `bonus_added`.

`tickets.status` needs nothing — `Escalated` has been in its CHECK since the
initial schema, written for the customer-refusal path. The two are told apart by
`technician_id`: a refusal always has one, an unaccepted escalation never does.

**Both new kinds are written by code landing in this same change** (
`tickets.sweeps.sweep_unaccepted` and `tickets.service.add_bonus_and_renotify`),
per hard rule 8 — a vocabulary declared ahead of its rows is how `audit_logs`
ended up a table nothing wrote to.

No index on `bonus_paise`. Nothing filters or sorts by it: the escalation queue
is keyed on `(status, technician_id)`, which `ix_tickets_company_status` already
serves, and the bonus is only ever read off a row somebody already has.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b52e7c04a91f"
down_revision: Union[str, Sequence[str], None] = "e6b40d92c7a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BASE = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded'"
)
_OLD = f"kind IN ({_BASE})"
_NEW = f"kind IN ({_BASE}, 'escalated', 'bonus_added')"


def upgrade() -> None:
    # Nullable with no server_default: every existing ticket genuinely has no
    # bonus, and backfilling a 0 would assert that somebody priced each of them
    # at nothing extra.
    op.add_column("tickets", sa.Column("bonus_paise", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "bonus_paise", "tickets", "bonus_paise IS NULL OR bonus_paise > 0"
    )

    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _NEW)


def downgrade() -> None:
    # Rows of the new kinds cannot satisfy the old CHECK, so they go. Same
    # trade-off `49d390e4d876` made for `reminded`: leaving them would make the
    # constraint uncreatable and the downgrade a dead end.
    #
    # Tickets sitting in `Escalated` with no technician are NOT moved back to
    # `New`. The status is valid under the old CHECK, and silently re-publishing
    # somebody's escalated jobs during a rollback would put them in front of
    # technicians nobody expected.
    op.execute(
        "DELETE FROM ticket_events WHERE kind IN ('escalated', 'bonus_added')"
    )
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _OLD)

    op.drop_constraint("bonus_paise", "tickets", type_="check")
    op.drop_column("tickets", "bonus_paise")
