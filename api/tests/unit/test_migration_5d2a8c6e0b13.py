"""Pins the migration's identity and its pure part (Task 02 §6 case 16).

Loaded by file path rather than imported as `app.*` — alembic revision files
are not a package, and `alembic.op` imports fine outside of a migration
context, so the module loads with no database at all. Same shape as
test_migration_3b7e1f0a9c41.py.
"""

import importlib.util
from pathlib import Path

from app.models.role import FRANCHISEE_ADMIN, FACILITY_ADMIN, FACILITY_OPERATOR

_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "5d2a8c6e0b13_franchise_roles_and_features.py"
)
_spec = importlib.util.spec_from_file_location("migration_5d2a8c6e0b13", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def test_revision_identity() -> None:
    assert migration.revision == "5d2a8c6e0b13"
    assert migration.down_revision == "3b7e1f0a9c41"


def test_roles_match_role_ranks() -> None:
    assert dict((k, r) for k, _l, r in migration.ROLES) == {
        FRANCHISEE_ADMIN: 8,
        FACILITY_ADMIN: 9,
        FACILITY_OPERATOR: 10,
    }


def test_defaults_equal_index_section_3_4() -> None:
    # Written literally from the index table — a silent edit to the migration's
    # DEFAULTS fails here, not in production reference data.
    assert migration.DEFAULTS == {
        "franchisees.manage": ["admin", "national_head"],
        "franchisees.view": ["admin", "national_head", "regional_head", "area_manager"],
        "franchise.technicians": ["franchisee_admin"],
        "franchise.payouts": ["franchisee_admin"],
        "franchise.pool": ["franchisee_admin"],
        "franchise.settings": ["franchisee_admin"],
        "franchise.statements": ["franchisee_admin"],
        "franchise.tickets": ["franchisee_admin", "facility_admin", "facility_operator"],
        "franchise.facility_users": ["franchisee_admin", "facility_admin"],
        "parts.handle": ["franchisee_admin", "facility_admin", "facility_operator"],
        "parts.catalogue": ["admin", "national_head"],
    }


def test_every_default_target_is_a_declared_feature() -> None:
    feature_keys = {k for k, _l, _p, _s in migration.FEATURES}
    assert set(migration.DEFAULTS) <= feature_keys


def test_every_parent_appears_earlier() -> None:
    seen: set[str] = set()
    for key, _label, parent, _sort in migration.FEATURES:
        if parent is not None:
            assert parent in seen, f"{key} names parent {parent}, not yet declared"
        seen.add(key)


def test_no_staff_role_is_handed_parts_handle() -> None:
    # Owner ruling 2026-10-15 (R4).
    assert set(migration.DEFAULTS["parts.handle"]) == {
        "franchisee_admin",
        "facility_admin",
        "facility_operator",
    }


def test_downgrade_blockers() -> None:
    assert migration.downgrade_blockers(0) == []
    blockers = migration.downgrade_blockers(2)
    assert len(blockers) == 1
    assert "2 user(s)" in blockers[0]