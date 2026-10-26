"""Task 04 §6, cases 1–25 — the pure routing decisions.

No database (X1): every function in `app.core.franchise_routing` is stdlib plus
`uuid`, so these run against nothing but the module. The SQL half of each rule
(the five eligibility places, `restamp_ticket`, `assert_pincodes_in_franchisee`)
is proven by §7's acceptance checks against the dev database instead.
"""

import uuid

from app.core.franchise import route_pincodes
from app.core.franchise_routing import (
    accept_miss_reason,
    codes_outside,
    franchise_hears_ticket,
    needs_restamp,
    outside_message,
    pool_frame_matches,
)

_HOME = uuid.uuid4()
_SKYFIX = uuid.uuid4()


# ── needs_restamp (cases 1–3) ────────────────────────────────────────────────


def test_needs_restamp_same_owner_is_false() -> None:
    assert needs_restamp(_SKYFIX, _SKYFIX) is False


def test_needs_restamp_different_owner_is_true() -> None:
    assert needs_restamp(_HOME, _SKYFIX) is True


def test_needs_restamp_unstamped_ticket_is_true() -> None:
    # `current is None` is not "matches": a ticket without a stamp is not a
    # ticket whose pincode is correctly routed.
    assert needs_restamp(None, _HOME) is True


# ── codes_outside, over Task 01's route_pincodes (cases 4–8) ─────────────────


def test_codes_all_routed_to_target_pass() -> None:
    routes = route_pincodes(
        {"500030", "500031"}, {"500030": _SKYFIX, "500031": _SKYFIX}, _HOME
    )
    assert codes_outside(["500030", "500031"], routes, _SKYFIX) == []


def test_target_is_home_sees_anothers_code_as_outside() -> None:
    routes = route_pincodes(["500032"], {"500032": _SKYFIX}, _HOME)
    assert codes_outside(["500032"], routes, _HOME) == ["500032"]


def test_target_is_franchisee_sees_unowned_home_code_as_outside() -> None:
    # A code nobody owns routes to the home (F4), so it is outside SkyFix's
    # range even though no `franchisee_pincodes` row names it.
    routes = route_pincodes(["600001"], {}, _HOME)
    assert codes_outside(["600001"], routes, _SKYFIX) == ["600001"]


def test_duplicates_and_unsorted_input_come_back_sorted_and_deduped() -> None:
    routes = route_pincodes(
        ["500031", "500030", "500031"], {"500030": _HOME, "500031": _HOME}, _HOME
    )
    assert codes_outside(
        ["500031", "500030", "500031", "500030"], routes, _SKYFIX
    ) == ["500030", "500031"]


def test_empty_input_passes() -> None:
    assert codes_outside([], {}, _HOME) == []


# ── outside_message (cases 9–11) ─────────────────────────────────────────────


def test_message_with_owner_names_groups_and_names_them() -> None:
    got = outside_message(
        "Acme Home",
        ["500032", "500033"],
        owner_names={"500032": "SkyFix Services", "500033": "SkyFix Services"},
    )
    assert got == (
        "Outside Acme Home: 500032, 500033 (SkyFix Services). "
        "Pick pincodes Acme Home owns."
    )


def test_message_without_owner_names_hides_the_other_franchisee() -> None:
    got = outside_message(
        "Acme Home",
        ["500032", "500033"],
        owner_names={"500032": "SkyFix Services", "500033": "SkyFix Services"},
    )
    hidden = outside_message("Acme Home", ["500032", "500033"], owner_names=None)
    assert hidden == "Outside your franchisee: 500032, 500033. Pick pincodes it owns."
    # One franchisee's admin — or a technician at registration — is not told
    # who owns another franchisee's codes.
    assert "SkyFix" not in hidden
    assert got != hidden


def test_twenty_five_codes_are_truncated_to_twenty_and_a_count() -> None:
    codes = [f"{600000 + i:06d}" for i in range(25)]
    got = outside_message(
        "Acme Home",
        codes,
        owner_names={c: "SkyFix Services" for c in codes},
    )
    shown = [c for c in codes[:20] if c in got]
    assert len(shown) == 20
    assert codes[20] not in got and "600024" not in got
    assert "and 5 more" in got


# ── accept_miss_reason (cases 12–14) ─────────────────────────────────────────


def test_open_and_same_franchisee_means_cap() -> None:
    assert accept_miss_reason(still_open=True, same_franchisee=True) == "cap"


def test_open_but_other_franchisee_means_moved() -> None:
    assert accept_miss_reason(still_open=True, same_franchisee=False) == "moved"


def test_not_open_means_taken_whatever_the_franchisee() -> None:
    assert accept_miss_reason(still_open=False, same_franchisee=True) == "taken"
    assert accept_miss_reason(still_open=False, same_franchisee=False) == "taken"


# ── pool_frame_matches (cases 15–20) ─────────────────────────────────────────

_TW = uuid.uuid4()
_ANDROID_TV = uuid.uuid4()


def test_pincode_path_and_franchisee_matching_matches() -> None:
    assert pool_frame_matches(
        pincodes={"500032"},
        nodes={_TW},
        franchisee_id=_SKYFIX,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
    )


def test_other_franchisees_frame_does_not_ring() -> None:
    assert not pool_frame_matches(
        pincodes={"500032"},
        nodes={_TW},
        franchisee_id=_HOME,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
    )


def test_unstamped_publisher_frame_is_decided_by_coverage_alone() -> None:
    # An old payload without "franchisee_id", or a deliberate frame for anyone:
    # this socket is biased toward ringing too often, so the old shape still
    # reaches every technician it used to.
    assert pool_frame_matches(
        pincodes={"500032"},
        nodes={_TW},
        franchisee_id=_SKYFIX,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=None,
    )


def test_viewer_cache_without_a_franchisee_is_decided_by_coverage_alone() -> None:
    assert pool_frame_matches(
        pincodes={"500032"},
        nodes={_TW},
        franchisee_id=None,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
    )


def test_same_franchisee_but_uncertified_pincode_does_not_ring() -> None:
    assert not pool_frame_matches(
        pincodes={"500032"},
        nodes={_TW},
        franchisee_id=_SKYFIX,
        event_pincode="500033",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
    )


def test_certification_on_an_ancestor_matches() -> None:
    # Descendant-aware, the unchanged behaviour: certified on *TV* matches an
    # *Android TV* job because *TV* rides in the job's stamped path.
    assert pool_frame_matches(
        pincodes={"500032"},
        nodes={_TW},
        franchisee_id=_SKYFIX,
        event_pincode="500032",
        event_path=[_ANDROID_TV, _TW],
        event_franchisee=_SKYFIX,
    )


# ── franchise_hears_ticket (cases 21–25) ─────────────────────────────────────


def test_same_franchisee_admin_hears() -> None:
    assert franchise_hears_ticket(
        viewer_franchisee=_SKYFIX, facility=False, event_franchisee=_SKYFIX
    )


def test_other_franchisee_does_not_hear() -> None:
    assert not franchise_hears_ticket(
        viewer_franchisee=_SKYFIX, facility=False, event_franchisee=_HOME
    )


def test_event_without_a_franchisee_is_silent() -> None:
    # An old frame must not be guessed AT here the way the pool socket guesses:
    # a ticket socket that over-rings tells a franchisee's console about work
    # it can read nothing of.
    assert not franchise_hears_ticket(
        viewer_franchisee=_SKYFIX, facility=False, event_franchisee=None
    )


def test_facility_viewer_is_silent_until_task_12() -> None:
    assert not franchise_hears_ticket(
        viewer_franchisee=_SKYFIX, facility=True, event_franchisee=_SKYFIX
    )


def test_viewer_without_a_franchisee_is_silent() -> None:
    assert not franchise_hears_ticket(
        viewer_franchisee=None, facility=False, event_franchisee=_SKYFIX
    )

# ── Task 18: the override (cases 26–31) ──────────────────────────────────────


def test_needs_restamp_is_false_for_a_handed_over_ticket_even_when_the_owner_differs() -> None:
    assert needs_restamp(_HOME, _SKYFIX, routing_override=True) is False
    assert needs_restamp(None, _SKYFIX, routing_override=True) is False


def test_needs_restamp_without_the_override_is_task_04s_three_cases() -> None:
    assert needs_restamp(_SKYFIX, _SKYFIX, routing_override=False) is False
    assert needs_restamp(_HOME, _SKYFIX, routing_override=False) is True
    assert needs_restamp(None, _HOME, routing_override=False) is True


def test_override_waives_the_pincode_for_the_matching_franchisee() -> None:
    # The viewer covers a different pincode entirely; the franchisee matches and the node is on the path.
    assert pool_frame_matches(
        pincodes={"500003"},
        nodes={_TW},
        franchisee_id=_SKYFIX,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
        event_override=True,
    )


def test_override_never_crosses_the_franchisee_wall() -> None:
    assert not pool_frame_matches(
        pincodes={"500003"},
        nodes={_TW},
        franchisee_id=_HOME,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
        event_override=True,
    )


def test_override_does_not_waive_certification() -> None:
    assert not pool_frame_matches(
        pincodes={"500003"},
        nodes={_ANDROID_TV},
        franchisee_id=_SKYFIX,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
        event_override=True,
    )


def test_override_omitted_keeps_the_coverage_test() -> None:
    assert not pool_frame_matches(
        pincodes={"500003"},
        nodes={_TW},
        franchisee_id=_SKYFIX,
        event_pincode="500032",
        event_path=[_TW],
        event_franchisee=_SKYFIX,
    )
