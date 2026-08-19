"""The expected serial becomes required.

Nullable was right while ops raised tickets: they often did not have the number,
and blocking a ticket over one nobody could see helped no one. That reason
expired when the VENDOR became the one raising them — the vendor holds the
invoice and the delivery note, so it is knowable at intake.

The payoff is on the other side of the job: AI verification compares the
photographed serial against the expected one, and an absent expectation reduced
that to a model-only check without saying so.

Deliberately NOT unique. A service call on a unit installed earlier legitimately
repeats the serial; uniqueness would refuse the second ticket on the same
appliance.

Runs after the re-seed, and only then. Fourteen of the twenty tickets that
existed before it had no serial, and there was nothing to backfill them from —
inventing serials to satisfy a constraint would have been worse than the
constraint arriving late.
"""

import sqlalchemy as sa
from alembic import op

revision = "f4a92b6c1d78"
down_revision = "b8c30d5e6f14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "tickets", "serial_number", existing_type=sa.String(64), nullable=False
    )


def downgrade() -> None:
    op.alter_column(
        "tickets", "serial_number", existing_type=sa.String(64), nullable=True
    )
