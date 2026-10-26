"""Pins the migration's identity and its pure downgrade guard (Task 01 §6).

Loaded by file path rather than imported as `app.*` — alembic revision files
are not a package, and `alembic.op` imports fine outside of a migration
context, so the module loads with no database at all.
"""

import importlib.util
from pathlib import Path

_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "3b7e1f0a9c41_every_company_has_franchisees.py"
)
_spec = importlib.util.spec_from_file_location("migration_3b7e1f0a9c41", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def test_revision_identity() -> None:
    assert migration.revision == "3b7e1f0a9c41"
    assert migration.down_revision == "f9c2d8a3e17b"


def test_downgrade_blockers_empty() -> None:
    assert migration.downgrade_blockers({}) == []
    assert (
        migration.downgrade_blockers(
            {
                "other_franchisees": 0,
                "franchisee_pincodes": 0,
                "franchise_memberships": 0,
                "employees": 0,
            }
        )
        == []
    )


def test_downgrade_blockers_one_nonzero() -> None:
    messages = migration.downgrade_blockers({"other_franchisees": 2})
    assert len(messages) == 1
    assert "2 franchisee(s)" in messages[0]


def test_downgrade_blockers_all_four_in_order() -> None:
    counts = {
        "other_franchisees": 2,
        "franchisee_pincodes": 3,
        "franchise_memberships": 1,
        "employees": 5,
    }
    messages = migration.downgrade_blockers(counts)
    assert len(messages) == 4
    assert "2 franchisee(s)" in messages[0]
    assert "3 pincode assignment(s)" in messages[1]
    assert "1 login(s)" in messages[2]
    assert "5 technician(s)" in messages[3]
