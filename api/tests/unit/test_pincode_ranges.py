"""Pins `app.core.pincode_ranges` (03 §6): the grammar, the limits, and the
round trip that guarantees what the screen shows is what gets stored."""

import pytest

from app.core.pincode_ranges import (
    MAX_CODES,
    MAX_TEXT_CHARS,
    MAX_TOKENS,
    PincodeRangeError,
    compress,
    empty_ranges,
    expand,
    parse,
    span,
)


# ── parse tests 1-13 ───────────────────────────────────────────────────────


@pytest.mark.parametrize("text", ["", "   ", None])
def test_empty_text_parses_to_nothing(text):
    assert parse(text) == []


def test_singles_and_ranges() -> None:
    assert parse("500001") == [(500001, 500001)]
    assert parse("500001-500099") == [(500001, 500099)]


@pytest.mark.parametrize(
    "text",
    [
        "500001 - 500099",   # spaces around a hyphen
        "500001–500099",     # U+2013 en dash, no spaces
        "500001 – 500099",   # en dash with spaces
    ],
)
def test_dash_variants_are_ranges(text) -> None:
    assert parse(text) == [(500001, 500099)]


@pytest.mark.parametrize("bad", ["500001—500099", "500001−500099"])
def test_em_dash_and_minus_are_invalid(bad) -> None:
    # U+2014 em dash and U+2212 minus are NOT separators.
    with pytest.raises(PincodeRangeError):
        parse(bad)


def test_reversed_range_refused_not_flipped() -> None:
    with pytest.raises(PincodeRangeError) as err:
        parse("500099-500001")
    assert "runs backwards" in str(err.value)
    assert err.value.tokens == ["500099-500001"]


def test_separators_and_surrounding_whitespace() -> None:
    assert parse("500001,500003;500005\n500007\r\n500009") == [
        (500001, 500001),
        (500003, 500003),
        (500005, 500005),
        (500007, 500007),
        (500009, 500009),
    ]
    # 500001 and 500002 are adjacent: parse's contract is merged ranges.
    assert parse(" 500001 ,\n 500002 ") == [(500001, 500002)]
    # A space is NOT a separator — the entry is two tokens and so invalid.
    with pytest.raises(PincodeRangeError):
        parse("500001 500002")


def test_empty_entries_between_separators_merge_adjacent() -> None:
    assert parse("500001,,, 500002") == [(500001, 500002)]


def test_overlap_adjacent_and_duplicates_merge() -> None:
    assert parse("500001-500010, 500005-500020") == [(500001, 500020)]
    assert parse("500001-500005, 500006-500009") == [(500001, 500009)]
    assert parse("500001,500001") == [(500001, 500001)]


def test_nfkc_fixes_fullwidth_digits() -> None:
    assert parse("５００００１") == [(500001, 500001)]


def test_devanagari_digits_invalid() -> None:
    with pytest.raises(PincodeRangeError):
        parse("५००००१")


@pytest.mark.parametrize(
    "bad",
    [
        "50001",                 # five digits
        "5000001",               # seven digits
        "050001",                # leading zero
        "abc",
        "5000O1",                # letter O, not zero
        "500001-",
        "-500001",
        "500001--500002",
        "500001-500002-500003",
    ],
)
def test_each_invalid_entry_raises_and_is_named(bad) -> None:
    with pytest.raises(PincodeRangeError) as err:
        parse(bad)
    assert bad in str(err.value)


def test_multiple_invalids_one_error_tokens_in_order_deduped() -> None:
    text = "abc, 50001, abc, 050001"
    with pytest.raises(PincodeRangeError) as err:
        parse(text)
    # Input ORDER, deduplicated: "abc" appears twice and is listed once.
    assert err.value.tokens == ["abc", "50001", "050001"]
    assert "abc" in str(err.value)
    assert "50001" in str(err.value)


def test_ten_shown_then_and_n_more() -> None:
    invalids = [f"abc{i}" for i in range(12)]
    with pytest.raises(PincodeRangeError) as err:
        parse(", ".join(invalids))
    for name in invalids[:10]:
        assert f'"{name}"' in str(err.value)
    assert "and 2 more" in str(err.value)
    assert '"abc11"' not in str(err.value)  # the 11th is folded into "and N more"


def test_valid_mixed_with_invalid_raises() -> None:
    with pytest.raises(PincodeRangeError):
        parse("500001, abc")


def test_span_limit() -> None:
    # Exactly 100,000 numbers — the cap, inclusive.
    assert parse("500000-599999") == [(500000, 599999)]
    with pytest.raises(PincodeRangeError) as err:
        parse("500000-600000")  # 100,001 numbers — one too many
    assert "500000-600000" in str(err.value)
    assert "split" in str(err.value)


def test_token_ceiling() -> None:
    # Step by two so the singles cannot merge into one range.
    ok = ", ".join(f"{500000 + 2 * i:06d}" for i in range(MAX_TOKENS))
    assert len(parse(ok)) == MAX_TOKENS
    with pytest.raises(PincodeRangeError) as err:
        parse(ok + f", {600000:06d}")
    assert "at most 500" in str(err.value)


def test_text_length_ceiling() -> None:
    # Exactly at the cap is fine — the commas are separators and empty entries
    # are dropped, so one pincode pads the text to the boundary.
    exact = "500001" + "," * (MAX_TEXT_CHARS - 6)
    assert len(exact) == MAX_TEXT_CHARS
    assert parse(exact) == [(500001, 500001)]
    with pytest.raises(PincodeRangeError) as err:
        parse(exact + ",")
    assert "too long" in str(err.value)


# ── expand / span / empty_ranges tests 14-18 ───────────────────────────────


EXISTING = ["500001", "500002", "500050", "600001"]


def test_expand_keeps_only_existing() -> None:
    assert expand([(500001, 500099)], EXISTING) == ["500001", "500002", "500050"]
    assert expand([(500001, 500001)], EXISTING) == ["500001"]
    # A single absent code -> nothing.
    assert expand([(500010, 500010)], EXISTING) == []


def test_expand_disjoint_ranges_union() -> None:
    assert expand([(500001, 500002), (600001, 600001)], EXISTING) == [
        "500001",
        "500002",
        "600001",
    ]


def test_expand_ignores_junk_in_existing() -> None:
    junky = EXISTING + ["ABC123", "12345"]
    assert expand([(500001, 500001)], junky) == ["500001"]
    # The junk never comes back out, whatever range is asked.
    assert expand([(100000, 999999)], junky) == EXISTING


def test_expand_code_ceiling() -> None:
    big_universe = [f"{600000 + i:06d}" for i in range(MAX_CODES + 1)]
    with pytest.raises(PincodeRangeError) as err:
        expand([(600000, 699999)], big_universe)
    assert f"{MAX_CODES + 1:,}" in str(err.value)


def test_span_counts_merged_numbers() -> None:
    assert span([(500001, 500099), (500120, 500120)]) == 100
    # Overlap counted once.
    assert span([(500001, 500010), (500005, 500020)]) == 20


def test_empty_ranges() -> None:
    assert empty_ranges([(500001, 500002), (500010, 500010), (600001, 600001)], EXISTING) == [
        (500010, 500010)
    ]


# ── compress tests 19-23 ───────────────────────────────────────────────────


def test_compress_basics() -> None:
    assert compress([]) == ""
    assert compress(["500003", "500001", "500002"]) == "500001-500003"
    assert compress(["500001", "500003"]) == "500001, 500003"
    assert compress(["500001", "500002"]) == "500001-500002"
    assert compress(["500001", "500001"]) == "500001"


def test_compress_universe_bridges_unheld_numbers() -> None:
    # 500003 is not in the universe (nothing to own there), so the run
    # continues across it.
    universe = ["500001", "500002", "500004"]
    codes = ["500001", "500002", "500004"]
    assert compress(codes, universe=universe) == "500001-500004"
    # Here 500003 IS in the universe but not owned — the run breaks.
    full = ["500001", "500002", "500003", "500004"]
    assert compress(["500001", "500002", "500004"], universe=full) == (
        "500001-500002, 500004"
    )


def test_compress_prints_codes_outside_universe() -> None:
    assert compress(["999999"], universe=["500001"]) == "999999"


@pytest.mark.parametrize(
    "ranges",
    [
        [(500001, 500010)],
        [(500001, 500010), (500120, 500135)],
        [(500001, 500010), (500012, 500020), (500120, 500135)],
        [(600001, 699999)],
    ],
)
def test_compress_and_parse_round_trip(ranges: list) -> None:
    universe = expand(ranges, [f"{620000 + i:06d}" for i in range(0, 900, 7)])
    owned = expand(ranges, universe)
    text = compress(owned, universe=universe)
    assert expand(parse(text), universe) == owned