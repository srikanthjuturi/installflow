"""Task 05 §6 — the migration's identity and its pure part.

Same shape as test_migration_5d2a8c6e0b13.py: loaded by file path, no
database — alembic revision files are not a package, and only the PURE
`downgrade_blockers` is pin-able without one. What the upgrade lays down on
RelianceDB is Task 05's acceptance #1, against the dev database (X1).
"""

import importlib.util
from pathlib import Path

_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "7c4f2e9a1d58_franchisee_admins_review_and_are_notified.py"
)
_spec = importlib.util.spec_from_file_location("migration_7c4f2e9a1d58", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def test_revision_identity() -> None:
    assert migration.revision == "7c4f2e9a1d58"
    assert migration.down_revision == "5d2a8c6e0b13"


def test_upgrade_widens_exactly_four_things() -> None:
    # The four facts the CHECKs of acceptance #1 assert — read back from the
    # literals the migration itself carries, so a silent widening of either
    # vocabulary fails here first.
    source = _PATH.read_text(encoding="utf-8")
    assert "'franchisee_admin'" in migration._NEW_AUDIENCE
    assert "franchisee_audience" in source
    assert "'franchisee_admin'" in migration._NEW_REVIEWER_ROLE
    assert migration._OLD_AUDIENCE.endswith("'vendor')")
    assert "technician_type" in source


def test_downgrade_blockers_pure() -> None:
    assert migration.downgrade_blockers(0, 0) == []
    blockers = migration.downgrade_blockers(2, 0)
    assert len(blockers) == 1
    assert "2 UPI change request(s)" in blockers[0]
    blockers = migration.downgrade_blockers(0, 3)
    assert len(blockers) == 1
    assert "3 ledger entry(ies)" in blockers[0]
    both = migration.downgrade_blockers(1, 1)
    assert len(both) == 2


def test_blockers_name_what_would_be_lost() -> None:
    both = migration.downgrade_blockers(1, 1)
    assert any("narrowing the CHECK" in b for b in both)
    assert any("redeemed by UPI" in b for b in both)