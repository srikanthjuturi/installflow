"""Pins `app.core.franchise`'s pure functions (00-index.md §4.1, Task 01 §6).

`create_home_franchisee` / `home_franchisee_id` / `franchisee_for_pincode` /
`franchisees_for_pincodes` all touch a database and are proven by Task 01's
acceptance criteria instead (X1) — only the pure half is tested here.
"""

import re
import uuid

from sqlalchemy.dialects import postgresql

from app.core.franchise import (
    franchisee_pincodes_subquery,
    home_franchisee_fields,
    route_pincodes,
)
from app.models.franchisee import HOME_CODE, KIND_INTERNAL

#: The code CHECK on `franchisees` (app/models/franchisee.py).
_CODE_PATTERN = re.compile(r"^[A-Z0-9]{2,8}$")


def test_home_franchisee_fields_shape() -> None:
    fields = home_franchisee_fields("Acme Appliances Pvt Ltd")
    assert fields == {
        "name": "Acme Appliances Pvt Ltd",
        "code": HOME_CODE,
        "kind": KIND_INTERNAL,
        "is_home": True,
        "is_active": True,
    }


def test_home_franchisee_fields_truncates_a_long_name() -> None:
    long_name = "A" * 300
    fields = home_franchisee_fields(long_name)
    assert len(fields["name"]) == 255
    assert fields["name"] == "A" * 255
    # The code is always HOME regardless of the name, and HOME itself matches
    # the CHECK the franchisees table carries.
    assert fields["code"] == "HOME"
    assert _CODE_PATTERN.match(fields["code"])


def test_route_pincodes_owner_else_home() -> None:
    owner = uuid.uuid4()
    home = uuid.uuid4()
    result = route_pincodes(["500032", "500001"], {"500032": owner}, home)
    assert result == {"500032": owner, "500001": home}


def test_route_pincodes_dedup_empty_and_unasked() -> None:
    owner = uuid.uuid4()
    home = uuid.uuid4()
    # Duplicates collapse.
    assert route_pincodes(["500032", "500032"], {}, home) == {"500032": home}
    # Empty input -> empty output.
    assert route_pincodes([], {"500032": owner}, home) == {}
    # An owned code not asked for is not returned.
    result = route_pincodes(["500001"], {"500032": owner}, home)
    assert "500032" not in result
    assert result == {"500001": home}


def test_franchisee_pincodes_subquery_non_home() -> None:
    company_id = uuid.uuid4()
    franchisee_id = uuid.uuid4()
    stmt = franchisee_pincodes_subquery(company_id, franchisee_id, is_home=False)
    compiled = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "franchisee_pincodes.pincode" in compiled
    assert "franchisee_pincodes.company_id" in compiled
    assert "franchisee_pincodes.franchisee_id" in compiled
    assert str(company_id) in compiled
    assert str(franchisee_id) in compiled


def test_franchisee_pincodes_subquery_home() -> None:
    company_id = uuid.uuid4()
    franchisee_id = uuid.uuid4()
    stmt = franchisee_pincodes_subquery(company_id, franchisee_id, is_home=True)
    compiled = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "pincodes.code" in compiled
    assert "pincodes.is_active" in compiled
    assert "NOT IN" in compiled.upper()
    # The home's answer does not filter on a specific franchisee id at all.
    assert str(franchisee_id) not in compiled
