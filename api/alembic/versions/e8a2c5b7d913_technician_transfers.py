"""Technician transfers — who moved a technician between franchisees, and why

A technician belongs to one franchisee. Moving them is a deliberate act with
consequences (their pool, their payer, their pincodes), so it is written down:
who, when, why, from, to, and the exact pincodes before and after. Append-only;
a correction is another transfer.

Downgrade refuses while any row exists — dropping the table would lose the only
record of why a technician is where they are (the f3c9a2d71b58 / f4b28d1a67c3
shape).

One new table, nothing altered: `notifications.kind` already allows
`technician_moved` (Task 01) and `notifications.audience` already allows
`franchisee_admin` (Task 05). The four CHECKs are written BARE - the naming
convention prefixes `ck_technician_transfers_`.

Revision ID: e8a2c5b7d913
Revises: d6c3a9f1e874
Create Date: 2026-10-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8a2c5b7d913"
down_revision: Union[str, Sequence[str], None] = "d6c3a9f1e874"  # re-point to the current head if the chain moved (never a branch)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "technician_transfers",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("technician_id", sa.Uuid(), nullable=False),
        sa.Column("from_franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("to_franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("technician_type", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("coverage_before", postgresql.JSONB(), nullable=False),
        sa.Column("coverage_after", postgresql.JSONB(), nullable=False),
        sa.Column("transferred_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("transferred_by_label", sa.String(length=120), nullable=False),
        sa.Column("transferred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("from_franchisee_id <> to_franchisee_id", name="different_franchisees"),
        sa.CheckConstraint("char_length(btrim(reason)) >= 5", name="reason_length"),
        sa.CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        sa.CheckConstraint(
            "jsonb_typeof(coverage_before) = 'array' AND jsonb_typeof(coverage_after) = 'array' "
            "AND jsonb_array_length(coverage_after) > 0",
            name="coverage_shape",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_transfers_company_technician", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "from_franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            name="fk_technician_transfers_company_from", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "to_franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            name="fk_technician_transfers_company_to", ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_technician_transfers_company_technician", "technician_transfers",
                    ["company_id", "technician_id", "transferred_at"])
    op.create_index("ix_technician_transfers_company_from", "technician_transfers",
                    ["company_id", "from_franchisee_id"])
    op.create_index("ix_technician_transfers_company_to", "technician_transfers",
                    ["company_id", "to_franchisee_id"])


def downgrade() -> None:
    n = op.get_bind().scalar(sa.text("SELECT count(*) FROM technician_transfers"))
    if n:
        raise RuntimeError(
            f"{n} technician transfer(s) are recorded. Dropping the table would lose who moved whom and why. "
            "Export them first, then delete the rows deliberately."
        )
    op.drop_index("ix_technician_transfers_company_to", table_name="technician_transfers")
    op.drop_index("ix_technician_transfers_company_from", table_name="technician_transfers")
    op.drop_index("ix_technician_transfers_company_technician", table_name="technician_transfers")
    op.drop_table("technician_transfers")
