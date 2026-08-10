"""masters feature keys

Revision ID: ef3a0a02c5c3
Revises: 2405b93c20fe
Create Date: 2026-08-10

Feature keys for the product master, so Categories stops borrowing the generic
`settings.view` gate. `masters.view` is read (every management role needs the
picklist to file a ticket or onboard a technician); `masters.edit` is write.

Also seeds `territory.view`, which the adminWeb nav has referenced since the
Territory screen shipped but which was never added to the catalog — an effective
feature that is absent resolves to false, so that screen is currently reachable
only because `RequireFeature` was never exercised against a real catalog miss.

Idempotent throughout: a feature or default that already exists is skipped, so
this is safe to re-run over a partially-seeded database.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ef3a0a02c5c3'
down_revision: Union[str, Sequence[str], None] = '2405b93c20fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (key, label, parent_key, sort_order)
FEATURES = [
    ("masters.view", "Product Master", None, 85),
    ("masters.edit", "Edit Product Master", "masters.view", 86),
    ("territory.view", "Territory", None, 87),
]

# role -> the keys it holds by default.
DEFAULTS = {
    "admin": ["masters.view", "masters.edit", "territory.view"],
    "national_head": ["masters.view", "masters.edit", "territory.view"],
    "regional_head": ["masters.view", "territory.view"],
    "area_manager": ["masters.view"],
}


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
    for role, keys in DEFAULTS.items():
        for key in keys:
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
    keys = [key for key, *_rest in FEATURES]

    for key in keys:
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

    # Children before parents — features.parent_key is a self-FK.
    for key in ("masters.edit", "masters.view", "territory.view"):
        conn.execute(
            sa.text("DELETE FROM features WHERE key = CAST(:key AS varchar)"),
            {"key": key},
        )
