"""technician onboarding feature keys

Revision ID: 79bab1e4577f
Revises: e3cb6cf2941c
Create Date: 2026-08-10

Write access to the Technicians screen, split from the existing read-only
`technicians.view`.

`technicians.edit` also gates deactivate and remove: four toggles for one screen
is more knobs than value.

All four management roles get all three by default. Area Manager included on
purpose — onboarding technicians into their own pincodes is the core of the job,
and the service restricts an ASM to their own territory rather than withholding
the button.

Idempotent: a feature or default that already exists is skipped.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '79bab1e4577f'
down_revision: Union[str, Sequence[str], None] = 'e3cb6cf2941c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (key, label, parent_key, sort_order)
FEATURES = [
    ("technicians.create", "Onboard Technician", "technicians.view", 61),
    ("technicians.invite", "Invite Technician", "technicians.view", 62),
    ("technicians.edit", "Edit Technician", "technicians.view", 63),
]
ROLES = ["admin", "national_head", "regional_head", "area_manager"]


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()

    for key, label, parent_key, sort_order in FEATURES:
        conn.execute(
            sa.text(
                """
                INSERT INTO features (key, label, parent_key, sort_order)
                SELECT CAST(:key AS varchar), CAST(:label AS varchar),
                       CAST(:parent_key AS varchar), CAST(:sort_order AS integer)
                WHERE NOT EXISTS (
                    SELECT 1 FROM features f WHERE f.key = CAST(:key AS varchar)
                )
                """
            ),
            {
                "key": key,
                "label": label,
                "parent_key": parent_key,
                "sort_order": sort_order,
            },
        )

    # CAST(...) on both sides: a parameter reused in a SELECT list and a WHERE
    # makes Postgres raise AmbiguousParameter.
    for role in ROLES:
        for key, *_rest in FEATURES:
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
                {"role": role, "key": key},
            )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    for key, *_rest in FEATURES:
        for table in ("role_feature_defaults", "company_role_features"):
            conn.execute(
                sa.text(
                    f"""
                    DELETE FROM {table}
                    WHERE feature_id IN (
                        SELECT id FROM features WHERE key = CAST(:key AS varchar)
                    )
                    """
                ),
                {"key": key},
            )
        conn.execute(
            sa.text("DELETE FROM features WHERE key = CAST(:key AS varchar)"),
            {"key": key},
        )
