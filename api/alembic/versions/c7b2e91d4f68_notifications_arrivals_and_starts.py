"""notifications: technician_joined, job_started, invite_expired

Three events that happened all along and told nobody.

A technician registering off an invite was visible only to whoever thought to
open the technicians list. Proof being submitted — the first moment anyone
outside the app knows a visit is really happening — moved a status and nothing
else. And an invite nobody used simply rotted: its status was flipped lazily, on
the next attempted resend, so an invite that was never resent stayed `sent` for
ever and the manager who sent it was never told.

Same shape as `49d390e4d876` did for ticket_events: widen the CHECK, and on the
way back down delete the rows the old constraint cannot accept.

Revision ID: c7b2e91d4f68
Revises: a3f1c204b7e9
Create Date: 2026-08-28 11:48:31.204517

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7b2e91d4f68'
down_revision: Union[str, Sequence[str], None] = 'a3f1c204b7e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BASE = "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot'"
_ADDED = ("technician_joined", "job_started", "invite_expired")
_OLD = f"kind IN ({_BASE})"
_NEW = f"kind IN ({_BASE}, " + ", ".join(f"'{k}'" for k in _ADDED) + ")"


def upgrade() -> None:
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", _NEW)


def downgrade() -> None:
    # Rows of the new kinds cannot satisfy the old CHECK. They are a record of
    # things that really happened, so this loses information — but leaving them
    # would make the constraint uncreatable and the downgrade a dead end.
    #
    # `notification_reads` first: it has a FK to these rows, and the read marks
    # are worthless once the notification they point at is gone.
    added = ", ".join(f"'{k}'" for k in _ADDED)
    op.execute(
        "DELETE FROM notification_reads WHERE notification_id IN "
        f"(SELECT id FROM notifications WHERE kind IN ({added}))"
    )
    op.execute(f"DELETE FROM notifications WHERE kind IN ({added})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", _OLD)
