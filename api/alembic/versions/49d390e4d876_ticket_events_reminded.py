"""ticket_events: reminded

Revision ID: 49d390e4d876
Revises: d91c8f17eaf4
Create Date: 2026-08-26 16:22:25.271267

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '49d390e4d876'
down_revision: Union[str, Sequence[str], None] = 'd91c8f17eaf4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BASE = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected'"
)
_OLD = f"kind IN ({_BASE})"
_NEW = f"kind IN ({_BASE}, 'reminded')"


def upgrade() -> None:
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _NEW)


def downgrade() -> None:
    # Rows of the new kind cannot satisfy the old CHECK. They are a record of a
    # reminder that really was sent, so this loses information — but leaving
    # them would make the constraint uncreatable and the downgrade a dead end.
    op.execute("DELETE FROM ticket_events WHERE kind = 'reminded'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _OLD)
