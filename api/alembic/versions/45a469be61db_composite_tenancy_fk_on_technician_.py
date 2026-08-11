"""composite tenancy fk on technician profile membership

Revision ID: 45a469be61db
Revises: ed5d2a079020
Create Date: 2026-08-11

The link the previous migration missed, found by `app.scripts.audit_tenancy`.

`technician_profiles.membership_id` was still a single-column FK, so a profile
carrying company A's `company_id` could point at a membership belonging to
company B. Nothing in the application does that — the profile is always created
from the membership it was just made for — but nothing in the database stopped
it either, which is the same gap the previous migration closed everywhere else.

`memberships` already has the UNIQUE on (company_id, id) this needs; it was
added for `manager_id`, which has used this pattern since the schema was first
written.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '45a469be61db'
down_revision: Union[str, Sequence[str], None] = 'ed5d2a079020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    # Resolved rather than spelled out: Postgres caps identifiers at 63
    # characters and rewrites longer ones, so the stored name may not be the
    # one the model appears to give it.
    old_fk = conn.execute(
        sa.text(
            """
            SELECT conname FROM pg_constraint
            WHERE contype = 'f'
              AND conrelid = 'technician_profiles'::regclass
              AND confrelid = 'memberships'::regclass
              AND conkey = ARRAY[(
                  SELECT attnum FROM pg_attribute
                  WHERE attrelid = 'technician_profiles'::regclass
                    AND attname = 'membership_id'
              )]
            """
        )
    ).scalar()
    if old_fk:
        op.drop_constraint(old_fk, "technician_profiles", type_="foreignkey")

    op.create_foreign_key(
        "fk_technician_profiles_company_membership",
        "technician_profiles",
        "memberships",
        ["company_id", "membership_id"],
        ["company_id", "id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "fk_technician_profiles_company_membership",
        "technician_profiles",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_technician_profiles_membership",
        "technician_profiles",
        "memberships",
        ["membership_id"],
        ["id"],
        ondelete="CASCADE",
    )
