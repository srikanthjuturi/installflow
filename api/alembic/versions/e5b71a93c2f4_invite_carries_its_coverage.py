"""An invite carries the coverage the manager assigned.

Coverage used to be chosen by the person joining, on their phone, at the end of
registration. That was the wrong hand on the pen: the manager knows the area
and the workload, and a technician picking their own could claim a district
nobody meant to give them. Worse, the only guard was the inviting area
manager's own list — so an invite from anyone more senior had no bound at all
and a technician could type any six digits, including a pincode that does not
exist.

Now the manager assigns region AND pincodes when sending the invite, validated
against the geography master. The app shows the list and does not offer to
change it, so there is nothing for a technician to get wrong.

The rows are COPIED onto `technician_pincodes` at registration rather than
joined through. The invite is a record of what was offered and stays as it was;
the profile owns what the technician actually covers, and a later edit to one
must not silently rewrite the other.

`uq_technician_invites_company_id_id` is added purely as the composite foreign
key target — the invite table had no such unique, so a child could not be
constrained to the same company (api/AGENTS.md rule 1).
"""

import sqlalchemy as sa
from alembic import op

revision = "e5b71a93c2f4"
down_revision = "d84c2e60ab17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_technician_invites_company_id_id",
        "technician_invites",
        ["company_id", "id"],
    )

    op.create_table(
        "technician_invite_pincodes",
        sa.Column("invite_id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("pincode", sa.String(length=6), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"],
            name=op.f("fk_technician_invite_pincodes_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "invite_id"],
            ["technician_invites.company_id", "technician_invites.id"],
            name="fk_invite_pincodes_company_invite",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_technician_invite_pincodes")),
        sa.UniqueConstraint("invite_id", "pincode", name="uq_invite_pincode"),
    )
    op.create_index(
        "ix_technician_invite_pincodes_invite",
        "technician_invite_pincodes",
        ["invite_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_technician_invite_pincodes_invite",
        table_name="technician_invite_pincodes",
    )
    op.drop_table("technician_invite_pincodes")
    op.drop_constraint(
        "uq_technician_invites_company_id_id",
        "technician_invites",
        type_="unique",
    )
