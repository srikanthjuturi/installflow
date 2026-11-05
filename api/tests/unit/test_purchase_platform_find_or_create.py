"""A7's "Others" path — `core.purchase_platforms.match_existing`.

`find_or_create` itself needs a database (a read, then an insert or an
update) and so has no place in this DB-free suite (X1) — but the
dedupe/reactivate DECISION it makes is pure, split out for exactly this
reason (`core.carve_out.plan_carve_out`'s own shape). These tests drive that
decision directly, with hand-built `(id, name, is_active)` tuples standing
in for what a real query would have returned.
"""

import uuid

from app.core.purchase_platforms import DEFAULT_PURCHASE_PLATFORMS, match_existing

_AMAZON = uuid.uuid4()
_FLIPKART = uuid.uuid4()


def test_no_rows_is_no_match() -> None:
    assert match_existing([], "Amazon") is None


def test_exact_match_is_already_active() -> None:
    existing = [(_AMAZON, "Amazon", True)]
    assert match_existing(existing, "Amazon") == (_AMAZON, False)


def test_match_is_case_insensitive() -> None:
    existing = [(_AMAZON, "Amazon", True)]
    assert match_existing(existing, "amazon") == (_AMAZON, False)
    assert match_existing(existing, "AMAZON") == (_AMAZON, False)


def test_match_ignores_surrounding_whitespace_on_both_sides() -> None:
    # The stored name is itself the product of a trim (every writer strips
    # it), but a caller of `match_existing` directly should not have to know
    # that — both sides are folded the same way.
    existing = [(_AMAZON, "  Amazon  ", True)]
    assert match_existing(existing, " amazon ") == (_AMAZON, False)


def test_retired_platform_matches_and_asks_to_be_reactivated() -> None:
    existing = [(_AMAZON, "Amazon", False)]
    assert match_existing(existing, "Amazon") == (_AMAZON, True)


def test_no_match_among_unrelated_rows() -> None:
    existing = [(_AMAZON, "Amazon", True), (_FLIPKART, "Flipkart", True)]
    assert match_existing(existing, "Myntra") is None


def test_picks_the_right_row_among_several() -> None:
    existing = [(_AMAZON, "Amazon", True), (_FLIPKART, "Flipkart", False)]
    assert match_existing(existing, "Flipkart") == (_FLIPKART, True)
    assert match_existing(existing, "Amazon") == (_AMAZON, False)


def test_default_seed_list_has_no_internal_duplicate() -> None:
    # A seed migration and `create_company` both insert this list verbatim —
    # a duplicate name in it (even differing only by case) would 409 on its
    # own second INSERT the moment this ships, company by company.
    folded = [name.lower() for name in DEFAULT_PURCHASE_PLATFORMS]
    assert len(folded) == len(set(folded))
    assert len(DEFAULT_PURCHASE_PLATFORMS) == 12
