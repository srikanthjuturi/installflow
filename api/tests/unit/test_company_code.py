"""Pins `unique_code` (03 §6): auto-suggesting a free franchisee code, with the
franchisee cap of 8 characters and case-insensitive collisions — pure, no
database."""

import pytest

from app.core.company_code import unique_code


def test_free_base_returned_verbatim() -> None:
    assert unique_code("SkyFix", {"RGT", "ACME"}) == "SKYFIX"


def test_taken_base_gets_suffix_two() -> None:
    assert unique_code("SFS", {"SFS"}) == "SFS2"


def test_suffixes_two_through_nine_taken_gives_ten() -> None:
    taken = {f"SFS{n}" for n in range(2, 10)} | {"SFS"}
    assert unique_code("SFS", taken) == "SFS10"


def test_suffix_never_exceeds_max_len() -> None:
    # An 8-character base whose full form is taken: the base is cut by one
    # character so the whole candidate — base + suffix — stays within the cap.
    assert unique_code("ABCDEFGH", {"ABCDEFGH"}) == "ABCDEFG2"


def test_long_base_truncated_when_free() -> None:
    # Free bases are capped at max_len too — codes never grow past the cap.
    assert unique_code("SkyFixServices", set()) == "SKYFIXSE"


def test_case_insensitive_collisions() -> None:
    assert unique_code("SFS", {"sfs"}) == "SFS2"
    assert unique_code("sfs", {"SKYFIX", "Sfs"}) == "SFS2"


def test_short_base_is_returned_when_it_meets_the_floor() -> None:
    # Two characters is the minimum, not a reason to suffix.
    assert unique_code("AB", {"ZZ"}) == "AB"


def test_max_len_below_floor_is_refused() -> None:
    with pytest.raises(ValueError):
        unique_code("SkyFix", set(), max_len=1)


def test_name_with_nothing_usable_is_refused() -> None:
    with pytest.raises(ValueError):
        unique_code("--", set())
    with pytest.raises(ValueError):
        unique_code("", set())


def test_every_suffix_exhausted_is_refused() -> None:
    # max_len 5: the free base is SKYFI, then SKYF2-9, then SKY10-99.
    taken = {"SKYFI"}
    taken |= {f"SKYF{n}" for n in range(2, 10)}
    taken |= {f"SKY{n}" for n in range(10, 100)}
    with pytest.raises(ValueError):
        unique_code("SkyFix", taken, max_len=5)