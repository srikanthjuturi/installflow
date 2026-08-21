"""A technician's daily job cap becomes optional, and loses its ceiling.

Two changes, one idea: the cap is a limit somebody chooses to impose, not a
fact about every technician.

**Nullable, and NULL means no limit.** It was `NOT NULL DEFAULT 5`, so every
technician asserted a cap of exactly five that nobody had set — the same
mistake `technician_profiles.jobs_completed` made with 0 and was fixed for in
`7b1e4a9c05d2`. A technician who has not been given a cap now has NULL, which
is a different claim from 5, and both clients render it as "Unlimited".

**No upper bound.** The CHECK was `BETWEEN 1 AND 12`; twelve was a guess. It is
now `>= 1` when set — a cap of zero would mean "never offer this person a job",
which is what `status` is for and should not be reachable by typing a number
into a cap field.

The manager no longer sets it when adding or inviting a technician: that screen
is about who the person is and where they work, and a cap invented at intake is
a number nobody has any basis for yet. The technician sets their own in the app
(Profile -> Availability & bandwidth), and a manager can change it afterwards.

Existing rows keep whatever they hold. The 5s already in the database are not
cleared to NULL — some of them may have been chosen deliberately, and this
migration cannot tell which, so it does not guess. New rows simply arrive NULL.
"""

import sqlalchemy as sa
from alembic import op

revision = "d84c2e60ab17"
down_revision = "c71d3fa8e520"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("technician_profiles", "technician_invites"):
        op.alter_column(
            table,
            "daily_job_cap",
            existing_type=sa.SmallInteger(),
            nullable=True,
            server_default=None,
        )

    # Only `technician_profiles` carried the range check.
    # WITHOUT the ck_<table>_ prefix: the naming convention adds it, and
    # passing it too asks for ck_technician_profiles_ck_technician_profiles_...
    op.drop_constraint("daily_job_cap", "technician_profiles", type_="check")
    op.create_check_constraint(
        "daily_job_cap",
        "technician_profiles",
        "daily_job_cap IS NULL OR daily_job_cap >= 1",
    )


def downgrade() -> None:
    # Anything unlimited has to become a number again to go back, and 5 is the
    # default it would have had. Stated here rather than silently: a downgrade
    # cannot preserve "no limit" in a NOT NULL column.
    op.execute(
        "UPDATE technician_profiles SET daily_job_cap = 5 WHERE daily_job_cap IS NULL"
    )
    op.execute(
        "UPDATE technician_invites SET daily_job_cap = 5 WHERE daily_job_cap IS NULL"
    )
    op.execute(
        "UPDATE technician_profiles SET daily_job_cap = 12 WHERE daily_job_cap > 12"
    )

    # WITHOUT the ck_<table>_ prefix: the naming convention adds it, and
    # passing it too asks for ck_technician_profiles_ck_technician_profiles_...
    op.drop_constraint("daily_job_cap", "technician_profiles", type_="check")
    op.create_check_constraint(
        "daily_job_cap",
        "technician_profiles",
        "daily_job_cap BETWEEN 1 AND 12",
    )

    for table in ("technician_profiles", "technician_invites"):
        op.alter_column(
            table,
            "daily_job_cap",
            existing_type=sa.SmallInteger(),
            nullable=False,
            server_default=sa.text("5"),
        )
