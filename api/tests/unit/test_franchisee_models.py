"""Pins the ORM shape Task 01 adds (00-index.md §3.1/§3.2, Task 01 §6).

Reads `Base.metadata` after `import app.models` — no database, no engine, just
the declarative model definitions the X1 guard still forbids connecting from.
"""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint

import app.models  # noqa: F401  registers every table on Base.metadata
from app.db.base_class import Base
from app.models.franchisee import HOME_CODE, KINDS
from app.models.technician import TECHNICIAN_TYPES

METADATA = Base.metadata

#: The seven (child table, child column) links that must point at `franchisees`.
_LINKS = [
    ("memberships", "franchisee_id"),
    ("technician_profiles", "franchisee_id"),
    ("technician_invites", "franchisee_id"),
    ("tickets", "franchisee_id"),
    ("ledger_entries", "franchisee_id"),
    ("redemptions", "franchisee_id"),
]
# franchisee_pincodes is the seventh, declared on the Franchisee module itself.
_ALL_LINKS = _LINKS + [("franchisee_pincodes", "franchisee_id")]


def test_vocabularies() -> None:
    assert KINDS == ("internal", "external")
    assert TECHNICIAN_TYPES == ("employee", "freelancer")
    assert HOME_CODE == "HOME"


def _check_constraint_ending(table_name: str, suffix: str) -> CheckConstraint:
    table = METADATA.tables[table_name]
    matches = [
        c
        for c in table.constraints
        if isinstance(c, CheckConstraint) and (c.name or "").endswith(suffix)
    ]
    assert len(matches) == 1, f"expected exactly one CHECK ending {suffix!r} on {table_name}, found {matches}"
    return matches[0]


def test_kind_check_mentions_every_kind() -> None:
    check = _check_constraint_ending("franchisees", "kind")
    text = str(check.sqltext)
    for kind in KINDS:
        assert kind in text


def test_technician_type_checks_mention_every_type() -> None:
    for table_name in ("technician_profiles", "technician_invites"):
        check = _check_constraint_ending(table_name, "technician_type")
        text = str(check.sqltext)
        for value in TECHNICIAN_TYPES:
            assert value in text


def test_every_link_is_a_composite_fk_to_franchisees() -> None:
    for child, column in _ALL_LINKS:
        table = METADATA.tables[child]
        fks = [c for c in table.constraints if isinstance(c, ForeignKeyConstraint)]
        matching = [
            fk
            for fk in fks
            if {col.name for col in fk.columns} == {"company_id", column}
            and all(elem.column.table.name == "franchisees" for elem in fk.elements)
        ]
        assert len(matching) == 1, f"{child}.{column}: expected one composite FK to franchisees, found {matching}"


def test_every_fk_has_a_covering_index() -> None:
    """The pure mirror of api/AGENTS.md's FK-coverage SQL — scoped to the FKs
    THIS task introduces or owns: `franchisees` -> companies,
    `franchisee_pincodes`'s three, and the six new `fk_*_company_franchisee`
    constraints. Every other FK on these tables pre-dates this task and is
    out of its scope."""
    named_fks = {
        "franchisees": {"fk_franchisees_company_id_companies"},
        "franchisee_pincodes": {
            "fk_franchisee_pincodes_company_id_companies",
            "fk_franchisee_pincodes_company_franchisee",
            "fk_franchisee_pincodes_pincode_pincodes",
        },
    }
    for child, _column in _LINKS:
        named_fks.setdefault(child, set()).add(f"fk_{child}_company_franchisee")

    for table_name, fk_names in named_fks.items():
        table = METADATA.tables[table_name]
        fks = {
            c.name: c
            for c in table.constraints
            if isinstance(c, ForeignKeyConstraint) and c.name in fk_names
        }
        assert set(fks) == fk_names, f"{table_name}: expected {fk_names}, found {set(fks)}"
        for fk in fks.values():
            fk_cols = [col.name for col in fk.columns]
            covered = False
            for idx in list(table.indexes) + [
                c for c in table.constraints if isinstance(c, (Index, UniqueConstraint))
            ]:
                idx_cols = [col.name for col in idx.columns]
                if idx_cols[: len(fk_cols)] == fk_cols:
                    covered = True
                    break
            assert covered, f"{table_name}: FK {fk.name} ({fk_cols}) has no covering index/unique"


def test_franchisee_id_nullability() -> None:
    not_null_tables = (
        "technician_profiles",
        "technician_invites",
        "tickets",
        "ledger_entries",
        "redemptions",
    )
    for table_name in not_null_tables:
        column = METADATA.tables[table_name].columns["franchisee_id"]
        assert column.nullable is False, f"{table_name}.franchisee_id should be NOT NULL"
    assert METADATA.tables["memberships"].columns["franchisee_id"].nullable is True


def test_home_uniques() -> None:
    franchisees = METADATA.tables["franchisees"]
    one_home = next(
        c for c in franchisees.indexes if c.name == "uq_franchisees_one_home"
    )
    assert one_home.unique is True
    assert one_home.dialect_options["postgresql"]["where"] is not None

    company_id_id = next(
        c
        for c in franchisees.constraints
        if isinstance(c, UniqueConstraint) and c.name == "uq_franchisees_company_id_id"
    )
    assert {col.name for col in company_id_id.columns} == {"company_id", "id"}
