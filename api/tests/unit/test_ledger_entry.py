"""Pins `core.ledger.entry`'s franchisee_id default (00-index.md §4.6, Task 01 §6).

Builds the row only — never flushed, never added to a session, so no database
is touched. `LedgerEntry(...)` is a plain ORM instantiation.
"""

import uuid

from sqlalchemy.sql.selectable import ScalarSelect

from app.core.ledger import entry


def test_franchisee_id_defaults_to_an_embedded_subquery() -> None:
    row = entry(
        company_id=uuid.uuid4(),
        technician_id=uuid.uuid4(),
        ticket_id=uuid.uuid4(),
        kind="penalty",
        amount_paise=30000,
        reason="Cancel < 2h before slot",
    )
    assert isinstance(row.franchisee_id, ScalarSelect)
    assert "technician_profiles.franchisee_id" in str(row.franchisee_id)


def test_franchisee_id_override_is_used_verbatim() -> None:
    override = uuid.uuid4()
    row = entry(
        company_id=uuid.uuid4(),
        technician_id=uuid.uuid4(),
        ticket_id=uuid.uuid4(),
        kind="reversal",
        amount_paise=30000,
        reason="Reversed",
        reverses_id=uuid.uuid4(),
        franchisee_id=override,
    )
    assert row.franchisee_id == override
