"""grant regional head and area manager jobs.create

Revision ID: 514f0c48297c
Revises: 2a1f716f699c
Create Date: 2026-08-10

Extends ticket intake (Manual Entry + Bulk Upload) down the management chain:
Regional Head and Area Manager join Admin and National Head in holding
jobs.create by default. Only the two new default rows are added here.

Idempotent: skips a (role, feature) that already has a default row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '514f0c48297c'
down_revision: Union[str, Sequence[str], None] = '2a1f716f699c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FEATURE_KEY = "jobs.create"
ROLES = ["regional_head", "area_manager"]


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    for role in ROLES:
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
            {"role": role, "key": FEATURE_KEY},
        )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    for role in ROLES:
        conn.execute(
            sa.text(
                """
                DELETE FROM role_feature_defaults
                WHERE role = CAST(:role AS varchar)
                  AND feature_id IN (
                      SELECT id FROM features WHERE key = CAST(:key AS varchar)
                  )
                """
            ),
            {"role": role, "key": FEATURE_KEY},
        )
