"""Drop `membership_pincodes`: an area manager covers states now.

`b2e94f07a1c3` added `membership_states` beside it. This removes the old table,
which nothing reads or writes any more.

An area manager used to be given a region plus a hand-typed list of six-digit
strings, with no catalogue to check them against — so a typo produced an area
nobody covered, and the honest answer to "which pincodes does he serve" was
"whichever ones somebody remembered to type". He is now given whole STATES and
covers every pincode inside them, resolved from the `pincodes` master at query
time. The stored list was both redundant and a second place for coverage to
disagree with itself.

**No data is migrated, because there is none.** `membership_pincodes` held 0
rows in every environment when this was written — the assignment flow had not
been used against real managers yet. A backfill script was written into the plan
for this step and then deleted rather than shipped: a migration that maps rows
nobody has is a migration nobody has tested. If this ever needs to run against a
database that DOES hold rows, the mapping is one statement —

    INSERT INTO membership_states (membership_id, company_id, state_id)
    SELECT DISTINCT mp.membership_id, mp.company_id, p.state_id
    FROM membership_pincodes mp JOIN pincodes p ON p.code = mp.pincode;

— but check first what it would silently drop: any pincode absent from the
master maps to nothing, and `uq_company_state` will refuse a state already held
by another manager. Run it, read the counts, and only then drop the table.

The downgrade recreates the table empty. It cannot restore assignments that were
never expressible as pincodes in the first place, and pretending otherwise by
expanding states back into codes would invent a list nobody typed.
"""

import sqlalchemy as sa
from alembic import op

revision = "c71d3fa8e520"
down_revision = "b2e94f07a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_membership_pincodes_membership_id", table_name="membership_pincodes"
    )
    op.drop_table("membership_pincodes")


def downgrade() -> None:
    op.create_table(
        "membership_pincodes",
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("pincode", sa.String(length=6), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"],
            name=op.f("fk_membership_pincodes_company_id_companies"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["memberships.id"],
            name=op.f("fk_membership_pincodes_membership_id_memberships"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_membership_pincodes")),
        sa.UniqueConstraint("company_id", "pincode", name="uq_company_pincode"),
    )
    op.create_index(
        "ix_membership_pincodes_membership_id",
        "membership_pincodes",
        ["membership_id"],
        unique=False,
    )
