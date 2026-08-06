"""seed roles, feature catalog, role defaults

Revision ID: ab9aa7e44f00
Revises: ea54e07cb88a
Create Date: 2026-08-06

Self-contained seed data (no app imports — migrations are frozen snapshots).
Roles are the 6 fixed roles. Features are a starter catalog. Defaults are the
shipped baseline per role (sparse: only enabled=true rows; absence => false).
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "ab9aa7e44f00"
down_revision: Union[str, Sequence[str], None] = "ea54e07cb88a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (key, label, rank)
ROLES = [
    ("superadmin", "Super Admin", 0),
    ("admin", "Admin", 1),
    ("national_head", "National Head", 2),
    ("regional_head", "Regional Head", 3),
    ("area_manager", "Area Manager", 4),
    ("technician", "Technician", 5),
]

# (key, label, parent_key, sort_order) — starter catalog for company-scoped roles.
FEATURES = [
    ("dashboard.view", "Dashboard", None, 10),
    ("users.view", "Users", None, 20),
    ("users.create", "Create User", "users.view", 21),
    ("users.edit", "Edit User", "users.view", 22),
    ("users.delete", "Delete User", "users.view", 23),
    ("roles.view", "Roles", None, 30),
    ("features.manage", "Feature Access", None, 31),
    ("jobs.view", "Jobs", None, 40),
    ("jobs.create", "Create Job", "jobs.view", 41),
    ("jobs.assign", "Assign Job", "jobs.view", 42),
    ("jobs.close", "Close Job", "jobs.view", 43),
    ("pool.view", "Job Pool", None, 50),
    ("technicians.view", "Technicians", None, 60),
    ("earnings.view", "Earnings", None, 70),
    ("reports.view", "Reports", None, 80),
    ("settings.view", "Settings", None, 90),
]

# role -> feature keys enabled by default (sparse; missing => disabled).
DEFAULTS = {
    "admin": [k for (k, *_rest) in FEATURES],  # admin gets every company feature
    "national_head": [
        "dashboard.view",
        "users.view", "users.create", "users.edit",
        "roles.view",
        "jobs.view", "jobs.assign",
        "pool.view", "technicians.view",
        "earnings.view", "reports.view",
    ],
    "regional_head": [
        "dashboard.view",
        "users.view",
        "jobs.view", "jobs.assign",
        "pool.view", "technicians.view",
        "reports.view",
    ],
    "area_manager": [
        "dashboard.view",
        "jobs.view", "jobs.assign",
        "pool.view", "technicians.view",
    ],
    "technician": [
        "dashboard.view",
        "jobs.view", "jobs.close",
        "pool.view",
    ],
}


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text("INSERT INTO roles (key, label, rank) VALUES (:key, :label, :rank)"),
        [{"key": k, "label": lbl, "rank": r} for (k, lbl, r) in ROLES],
    )

    conn.execute(
        sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order) "
            "VALUES (:key, :label, :parent_key, :sort_order)"
        ),
        [
            {"key": k, "label": lbl, "parent_key": pk, "sort_order": so}
            for (k, lbl, pk, so) in FEATURES
        ],
    )

    # Map feature key -> id to build the defaults rows.
    feature_ids = {
        row.key: row.id
        for row in conn.execute(sa.text("SELECT id, key FROM features"))
    }

    rows = [
        {"role": role, "feature_id": feature_ids[key], "enabled": True}
        for role, keys in DEFAULTS.items()
        for key in keys
    ]
    conn.execute(
        sa.text(
            "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
            "VALUES (:role, :feature_id, :enabled)"
        ),
        rows,
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM role_feature_defaults"))
    conn.execute(sa.text("DELETE FROM features"))
    conn.execute(sa.text("DELETE FROM roles"))
