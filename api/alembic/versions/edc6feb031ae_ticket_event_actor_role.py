"""ticket_events.actor_role — the real staff role at the time of the event.

Also merges the two open heads (user password/lockout + serials-unique) so the
tree has a single head again. Nullable, no backfill: historical rows read as
"…by a manager", exactly as before.
"""
from alembic import op
import sqlalchemy as sa

revision = "edc6feb031ae"
down_revision = ("b7c3f0a5d9e1", "d4f8a21b9c56")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ticket_events",
        sa.Column("actor_role", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ticket_events", "actor_role")
