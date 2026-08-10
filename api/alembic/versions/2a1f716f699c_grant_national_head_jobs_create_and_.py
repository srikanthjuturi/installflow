"""grant national head jobs.create and settings.view

Revision ID: 2a1f716f699c
Revises: fb71d2baf158
Create Date: 2026-08-10 12:05:29.427467

Widens the National Head baseline so the console shows the full management menu:
jobs.create unlocks Manual Entry + Bulk Upload, settings.view unlocks Vendors,
Categories and Rules Config. Admin already holds every feature, so only the
national_head default rows are added here.

Idempotent: skips a (role, feature) that already has a default row, so it is safe
to run against a DB where an operator granted one of these by hand.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '2a1f716f699c'
down_revision: Union[str, Sequence[str], None] = 'fb71d2baf158'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLE = "national_head"
FEATURE_KEYS = ["jobs.create", "settings.view"]


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    for key in FEATURE_KEYS:
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
            {"role": ROLE, "key": key},
        )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    for key in FEATURE_KEYS:
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
            {"role": ROLE, "key": key},
        )
