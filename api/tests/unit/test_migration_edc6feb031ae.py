import importlib.util
from pathlib import Path

_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "edc6feb031ae_ticket_event_actor_role.py"
)
_spec = importlib.util.spec_from_file_location("migration_edc6feb031ae", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def test_revision_identity() -> None:
    assert migration.revision == "edc6feb031ae"
    # Merges the two heads that existed before it.
    assert set(migration.down_revision) == {"b7c3f0a5d9e1", "d4f8a21b9c56"}


def test_upgrade_adds_actor_role_and_downgrade_drops_it() -> None:
    source = _PATH.read_text(encoding="utf-8")
    assert "actor_role" in source
    assert "add_column" in source
    assert "drop_column" in source
