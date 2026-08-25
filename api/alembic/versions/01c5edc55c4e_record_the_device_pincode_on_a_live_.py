"""record the device pincode on a live proof photo

One column. Autogenerate also proposed dropping every hand-written `LOWER()`
and partial index in the schema — including `uq_tickets_feedback_token`, added
one revision ago, which it cannot reflect and now offers to remove exactly as
that migration's docstring predicted. All of those drops have been deleted.

Revision ID: 01c5edc55c4e
Revises: 462d5b567b64
Create Date: 2026-08-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "01c5edc55c4e"
down_revision: Union[str, Sequence[str], None] = "462d5b567b64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable, and stays nullable: reverse geocoding can fail while the fix
    # itself is good, and refusing that would strand a technician standing at
    # the right door. The coordinates beside it are the evidence either way.
    op.add_column(
        "ticket_proofs", sa.Column("device_pincode", sa.String(length=6), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("ticket_proofs", "device_pincode")
