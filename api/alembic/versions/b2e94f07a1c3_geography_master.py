"""The geography master: states, districts, pincodes, and an area manager's states.

Until now `regions` was the whole of geography — five seeded rows and nothing
below them. A pincode was a bare six-character string typed by hand onto an area
manager's membership, with no catalogue to check it against, and three separate
places in the code worked around the gap. `tickets/service.py` said it plainly:
"there is no pincode -> region master anywhere in the system … if RH should see
by region proper, a pincode -> region table has to exist first."

This is that table. It is loaded from a spreadsheet by a superadmin
(`POST /geo/import`): 165,627 rows of Region/State/District/Pin Code collapsing
to 36 states, 754 districts and 19,490 pincodes.

Four of the five tables are GLOBAL — no `company_id`. India is the same shape
for every tenant, which is the argument `regions` has always made; who covers
what stays per-company on the membership. All four are registered in
`audit_tenancy.GLOBAL_TABLES` with that reason.

Two shapes here are deliberate and worth defending, because the obvious
alternative is wrong in both cases:

  * **`pincodes.code` is the primary key**, not a UUID. Every table that already
    stores a pincode stores the six characters, and a ticket arrives carrying
    nothing else, so a surrogate key would put a join in front of every lookup
    and buy nothing.
  * **`pincode_districts` is a join table**, not a `district_id` column. 1,258
    real pincodes span more than one district and one spans four, so a single
    column would have to discard the rest.

`membership_states` replaces `membership_pincodes`, which is left in place for
now: the backfill script maps existing pincode assignments to states through the
freshly imported master, and only then does a later migration drop it. It also
fixes a latent gap — `membership_pincodes.membership_id` is a plain FK, so a row
could name company A while pointing at a membership in company B. The
replacement uses the composite (company_id, membership_id) FK that
`api/AGENTS.md` rule 1 requires.

NB the two `lower()` uniques at the bottom are created with `op.execute`.
SQLAlchemy cannot express a functional index, so autogenerate will offer to DROP
them on the next run. That is a false positive; delete the drop.
"""

import sqlalchemy as sa
from alembic import op

revision = "b2e94f07a1c3"
down_revision = "f4a92b6c1d78"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "states",
        sa.Column("region_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["region_id"], ["regions.id"],
            name=op.f("fk_states_region_id_regions"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_states")),
    )
    op.create_index("ix_states_region_id", "states", ["region_id"], unique=False)

    op.create_table(
        "districts",
        sa.Column("state_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=96), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["state_id"], ["states.id"],
            name=op.f("fk_districts_state_id_states"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_districts")),
    )
    op.create_index("ix_districts_state_id", "districts", ["state_id"], unique=False)

    op.create_table(
        "pincodes",
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("state_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        # An Indian pincode never starts with 0. This also catches a spreadsheet
        # cell that arrived as the number 12345 and was padded back to "012345".
        sa.CheckConstraint("code ~ '^[1-9][0-9]{5}$'", name=op.f("ck_pincodes_format")),
        sa.ForeignKeyConstraint(
            ["state_id"], ["states.id"],
            name=op.f("fk_pincodes_state_id_states"), ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_pincodes")),
    )
    op.create_index("ix_pincodes_state_id", "pincodes", ["state_id"], unique=False)

    op.create_table(
        "pincode_districts",
        sa.Column("pincode_code", sa.String(length=6), nullable=False),
        sa.Column("district_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["district_id"], ["districts.id"],
            name=op.f("fk_pincode_districts_district_id_districts"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pincode_code"], ["pincodes.code"],
            name=op.f("fk_pincode_districts_pincode_code_pincodes"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("pincode_code", "district_id", name=op.f("pk_pincode_districts")),
    )
    # The PK's leading column covers the pincode FK; the other one needs its own
    # index or deleting a district scans the whole table to prove nothing points
    # at it.
    op.create_index(
        "ix_pincode_districts_district_id", "pincode_districts", ["district_id"], unique=False
    )

    op.create_table(
        "membership_states",
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("state_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"],
            name=op.f("fk_membership_states_company_id_companies"), ondelete="CASCADE",
        ),
        # Composite, so a row can never name one company's membership while
        # claiming another's company_id. Targets uq_memberships_company_id_id.
        sa.ForeignKeyConstraint(
            ["company_id", "membership_id"],
            ["memberships.company_id", "memberships.id"],
            name="fk_membership_states_company_membership", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["state_id"], ["states.id"],
            name=op.f("fk_membership_states_state_id_states"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_membership_states")),
        # This is what actually enforces "a state belongs to one area manager".
        # An application check alone would lose the race under concurrent writes.
        sa.UniqueConstraint("company_id", "state_id", name="uq_company_state"),
    )
    op.create_index(
        "ix_membership_states_membership_id", "membership_states", ["membership_id"], unique=False
    )
    op.create_index(
        "ix_membership_states_state_id", "membership_states", ["state_id"], unique=False
    )

    # Functional uniques — SQLAlchemy cannot express lower(), so these are here
    # and autogenerate will keep offering to drop them. It is wrong; keep them.
    #
    # State names are unique across India. Districts are NOT: AURANGABAD is in
    # both Maharashtra and Bihar, so the district unique is per state.
    op.execute("CREATE UNIQUE INDEX uq_states_name_lower ON states (lower(name))")
    op.execute(
        "CREATE UNIQUE INDEX uq_districts_state_name_lower "
        "ON districts (state_id, lower(name))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_districts_state_name_lower")
    op.execute("DROP INDEX IF EXISTS uq_states_name_lower")

    op.drop_index("ix_membership_states_state_id", table_name="membership_states")
    op.drop_index("ix_membership_states_membership_id", table_name="membership_states")
    op.drop_table("membership_states")

    op.drop_index("ix_pincode_districts_district_id", table_name="pincode_districts")
    op.drop_table("pincode_districts")

    op.drop_index("ix_pincodes_state_id", table_name="pincodes")
    op.drop_table("pincodes")

    op.drop_index("ix_districts_state_id", table_name="districts")
    op.drop_table("districts")

    op.drop_index("ix_states_region_id", table_name="states")
    op.drop_table("states")
