"""Pins the two tenancy/cleanup registries Task 01 extends (00-index.md hard
rule 0; Task 01 §3.5, §3.6, §6). No database — both scripts expose their
registries as plain module-level data the models can be checked against.
"""

import app.models  # noqa: F401  registers every table on Base.metadata
from app.db.base_class import Base
from app.scripts import audit_tenancy, cleanup_db

#: The seven new (child, column, parent) links Task 01 adds.
_NEW_LINKS = {
    ("franchisee_pincodes", "franchisee_id", "franchisees"),
    ("memberships", "franchisee_id", "franchisees"),
    ("technician_profiles", "franchisee_id", "franchisees"),
    ("technician_invites", "franchisee_id", "franchisees"),
    ("tickets", "franchisee_id", "franchisees"),
    ("ledger_entries", "franchisee_id", "franchisees"),
    ("redemptions", "franchisee_id", "franchisees"),
}


def test_tenant_links_include_the_seven_new_ones() -> None:
    present = set(audit_tenancy.TENANT_LINKS)
    missing = _NEW_LINKS - present
    assert not missing, f"missing TENANT_LINKS entries: {missing}"


def test_franchisees_tables_are_not_global() -> None:
    assert "franchisees" not in audit_tenancy.GLOBAL_TABLES
    assert "franchisee_pincodes" not in audit_tenancy.GLOBAL_TABLES


def test_cleanup_db_classification_is_complete() -> None:
    problems = cleanup_db.classification_problems(set(Base.metadata.tables), source="the models")
    assert problems == []
