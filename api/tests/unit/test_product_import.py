"""Pure, no-database tests for the bulk product importer's row-level rules.

`features/masters/import_service.import_products` needs a database for the
catalogue resolution and the write, so — like every other importer in this
codebase — it is not unit tested here (X1's guard in `conftest.py` refuses a
database connection outright). What IS pure, and worth pinning down, is
everything a row's own text decides before any query runs: the Category
chain grammar (duplicated from `tickets.import_service` under hard rule 4),
and the service-type / warranty / price / parameter cell parsers.
"""

from app.features.masters.import_service import (
    _parse_parameters,
    _parse_price,
    _parse_service_types,
    _parse_warranty,
    chain_path,
    parse_category_chain,
)


class TestParseCategoryChain:
    def test_simple_chain(self) -> None:
        chain = parse_category_chain(
            "Electronics, Television, Android TV(islastsubcategory)"
        )
        assert chain.code is None
        assert chain.segments == ["Electronics", "Television", "Android TV"]

    def test_comma_in_name_uses_angle_bracket_delimiter(self) -> None:
        chain = parse_category_chain(
            "Home > Cooking, Baking > Ovens(islastsubcategory)"
        )
        assert chain.code is None
        assert chain.segments == ["Home", "Cooking, Baking", "Ovens"]

    def test_empty_cell_is_rejected(self) -> None:
        chain = parse_category_chain("")
        assert chain.code == "CATEGORY_EMPTY"

    def test_missing_marker_is_rejected(self) -> None:
        chain = parse_category_chain("Electronics, Television")
        assert chain.code == "CATEGORY_MARKER_MISSING"

    def test_marker_not_on_last_segment_is_rejected(self) -> None:
        chain = parse_category_chain(
            "Electronics, Television(islastsubcategory), Android TV"
        )
        assert chain.code == "CATEGORY_MARKER_NOT_LAST"

    def test_repeated_marker_is_rejected(self) -> None:
        chain = parse_category_chain(
            "Electronics(islastsubcategory), Television(islastsubcategory)"
        )
        assert chain.code == "CATEGORY_MARKER_REPEATED"

    def test_misspelt_marker_is_rejected(self) -> None:
        chain = parse_category_chain("Electronics(is last subcat)")
        assert chain.code == "CATEGORY_MARKER_MISSPELT"

    def test_single_segment_chain_is_rejected(self) -> None:
        """A root alone would hold products, which `leaf_below_root` forbids."""
        chain = parse_category_chain("Electronics(islastsubcategory)")
        assert chain.code == "CATEGORY_LEAF_AT_ROOT"

    def test_leading_delimiter_is_rejected(self) -> None:
        chain = parse_category_chain(", Television(islastsubcategory)")
        assert chain.code == "CATEGORY_LEADING_DELIMITER"

    def test_trailing_delimiter_is_rejected(self) -> None:
        chain = parse_category_chain("Electronics, Television(islastsubcategory),")
        assert chain.code == "CATEGORY_TRAILING_DELIMITER"

    def test_key_is_case_insensitive(self) -> None:
        a = parse_category_chain("Electronics, TV(islastsubcategory)")
        b = parse_category_chain("electronics, tv(islastsubcategory)")
        assert a.key == b.key


def test_chain_path_uses_the_console_separator() -> None:
    assert chain_path(["Electronics", "Television"]) == "Electronics › Television"


class TestParseServiceTypes:
    def test_blank_defaults_to_the_baseline(self) -> None:
        types, err = _parse_service_types("")
        assert err is None
        assert types == ["Installation + Demo"]

    def test_known_types_are_reordered_to_catalogue_order(self) -> None:
        types, err = _parse_service_types("Service, Installation + Demo")
        assert err is None
        assert types == ["Installation + Demo", "Service"]

    def test_unknown_type_is_rejected(self) -> None:
        types, err = _parse_service_types("Repair")
        assert types == []
        assert err is not None and "Repair" in err


class TestParseWarranty:
    def test_blank_is_none(self) -> None:
        assert _parse_warranty("") == (None, None)

    def test_whole_number(self) -> None:
        assert _parse_warranty("12") == (12, None)

    def test_float_cell_from_a_spreadsheet(self) -> None:
        """openpyxl hands back `12.0` for a cell typed as a plain number."""
        assert _parse_warranty("12.0") == (12, None)

    def test_out_of_range_is_rejected(self) -> None:
        value, err = _parse_warranty("500")
        assert value is None
        assert err is not None

    def test_non_numeric_is_rejected(self) -> None:
        value, err = _parse_warranty("twelve")
        assert value is None
        assert err is not None


class TestParsePrice:
    def test_blank_is_none(self) -> None:
        assert _parse_price("") == (None, None)

    def test_positive_whole_number(self) -> None:
        assert _parse_price("35000") == (35000, None)

    def test_zero_is_rejected(self) -> None:
        value, err = _parse_price("0")
        assert value is None
        assert err is not None

    def test_negative_is_rejected(self) -> None:
        value, err = _parse_price("-100")
        assert value is None
        assert err is not None

    def test_over_the_ceiling_is_rejected(self) -> None:
        value, err = _parse_price("100000001")
        assert value is None
        assert err is not None

    def test_non_numeric_is_rejected(self) -> None:
        value, err = _parse_price("abc")
        assert value is None
        assert err is not None


class TestParseParameters:
    def test_blank_is_empty(self) -> None:
        assert _parse_parameters("") == ([], None)

    def test_one_pair(self) -> None:
        params, err = _parse_parameters("RAM:8 GB")
        assert err is None
        assert params == [{"name": "RAM", "value": "8 GB"}]

    def test_several_pairs_separated_by_semicolons(self) -> None:
        params, err = _parse_parameters("RAM:8 GB; Storage:128 GB")
        assert err is None
        assert params == [
            {"name": "RAM", "value": "8 GB"},
            {"name": "Storage", "value": "128 GB"},
        ]

    def test_missing_colon_is_rejected(self) -> None:
        params, err = _parse_parameters("RAM 8 GB")
        assert params == []
        assert err is not None

    def test_missing_value_is_rejected(self) -> None:
        """Every value is required on a PRODUCT — see `api/AGENTS.md`."""
        params, err = _parse_parameters("RAM:")
        assert params == []
        assert err is not None

    def test_duplicate_name_is_rejected_case_insensitively(self) -> None:
        params, err = _parse_parameters("RAM:8 GB; ram:16 GB")
        assert params == []
        assert err is not None
