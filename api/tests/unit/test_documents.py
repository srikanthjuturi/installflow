"""`app.core.documents` -- the pure half: series names, direction, party columns.

`issue()` needs a session and is proved against the dev database instead.
"""

import uuid

import pytest

from app.core import sequences
from app.core.documents import (
    DEFAULT_EFFECT,
    DocumentError,
    party_columns,
    sequence_name,
)
from app.models.transaction_document import DOC_TYPES


def test_every_document_type_has_a_series_and_a_default_direction():
    for doc_type in DOC_TYPES:
        assert sequence_name(doc_type) in sequences.KINDS
        assert doc_type in DEFAULT_EFFECT


def test_series_prefixes_are_distinct():
    prefixes = list(sequences.KINDS.values())
    assert len(prefixes) == len(set(prefixes))


def test_document_number_shape():
    assert (
        sequences.format_code("RGT", sequence_name("sales_invoice"), 1)
        == "RGT-INV-0001"
    )


def test_unknown_type_is_refused():
    with pytest.raises(DocumentError):
        sequence_name("tax_invoice")


@pytest.mark.parametrize("kind", ["vendor", "franchisee", "technician"])
def test_exactly_the_matching_party_column_is_set(kind):
    party = uuid.uuid4()
    columns = party_columns(kind, party)
    assert columns[f"{kind}_id"] == party
    assert [v for v in columns.values() if v is not None] == [party]


def test_platform_has_no_party_id():
    assert set(party_columns("platform", None).values()) == {None}
    with pytest.raises(DocumentError):
        party_columns("platform", uuid.uuid4())


def test_a_named_party_needs_an_id():
    with pytest.raises(DocumentError):
        party_columns("vendor", None)
    with pytest.raises(DocumentError):
        party_columns("customer", uuid.uuid4())
