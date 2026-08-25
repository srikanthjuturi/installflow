"""technician availability: accepting_work and last_seen_at

Two columns, and deliberately no index.

Autogenerate also proposed dropping fourteen indexes — every hand-written
`LOWER()` functional index and every partial index in the schema. It does that
because Alembic cannot reflect them and concludes they are stale; they are not,
and dropping them would silently remove the uniqueness that stops two companies
sharing a slug and two technicians sharing a phone. All of those drops have been
deleted from this file, per `api/AGENTS.md`.

Revision ID: c5c9299d0ecb
Revises: f7d3a52c9e01
Create Date: 2026-08-24 16:27:35.951062

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5c9299d0ecb"
down_revision: Union[str, Sequence[str], None] = "f7d3a52c9e01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the two halves of 'is this technician available'."""
    op.add_column(
        "technician_profiles",
        sa.Column(
            "accepting_work",
            sa.Boolean(),
            nullable=False,
            # Every existing technician has been treated as available since the
            # app shipped — the toggle defaulted to on and nothing persisted it.
            # Backfilling to true keeps that true rather than silently taking
            # the whole workforce out of the pool on deploy.
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "technician_profiles",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("technician_profiles", "last_seen_at")
    op.drop_column("technician_profiles", "accepting_work")
