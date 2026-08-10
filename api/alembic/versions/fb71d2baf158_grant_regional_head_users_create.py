"""grant regional_head users.create

Revision ID: fb71d2baf158
Revises: 89d57161b449
Create Date: 2026-08-08

A regional head staffs their own regions, so they need to add area managers
without going through an admin.

Only `users.create` — not edit or delete. The rank rule already limits WHO they
can create (roles below their own: area manager, technician) and the territory
rule limits WHERE (regions they hold), so this grant cannot reach outside their
patch.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "fb71d2baf158"
down_revision: Union[str, Sequence[str], None] = "89d57161b449"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLE = "regional_head"
KEY = "users.create"


def upgrade() -> None:
    conn = op.get_bind()
    # Idempotent: insert when missing, enable when present but off. Each bind
    # parameter is cast because one reused in both a SELECT list and a WHERE
    # makes Postgres report AmbiguousParameter.
    conn.execute(
        sa.text(
            """
            INSERT INTO role_feature_defaults (role, feature_id, enabled)
            SELECT CAST(:role AS varchar), f.id, true
            FROM features f
            WHERE f.key = CAST(:key AS varchar)
              AND NOT EXISTS (
                  SELECT 1 FROM role_feature_defaults rfd
                  WHERE rfd.role = CAST(:role AS varchar)
                    AND rfd.feature_id = f.id
              )
            """
        ),
        {"role": ROLE, "key": KEY},
    )
    conn.execute(
        sa.text(
            """
            UPDATE role_feature_defaults SET enabled = true
            WHERE role = CAST(:role AS varchar)
              AND feature_id = (
                  SELECT id FROM features WHERE key = CAST(:key AS varchar)
              )
            """
        ),
        {"role": ROLE, "key": KEY},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE FROM role_feature_defaults
            WHERE role = CAST(:role AS varchar)
              AND feature_id = (
                  SELECT id FROM features WHERE key = CAST(:key AS varchar)
              )
            """
        ),
        {"role": ROLE, "key": KEY},
    )
