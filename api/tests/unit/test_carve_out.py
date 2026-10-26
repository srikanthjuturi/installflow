"""Pins `app.core.carve_out` (03 §6): who moves, who is trimmed, which tickets
re-route — F6 tested with no database."""

import random
import uuid

from app.core.carve_out import (
    CarvePlan,
    clash_lines,
    clash_summary,
    diff_codes,
    find_clashes,
    plan_carve_out,
    ticket_moves,
)


def _codes() -> frozenset[str]:
    return frozenset(f"{500030 + i:06d}" for i in range(11))  # 500030-500040


TARGET_CODES = _codes()


# ── plan_carve_out tests 1-7 ───────────────────────────────────────────────


def test_coverage_entirely_inside_is_moved() -> None:
    tech = uuid.uuid4()
    plan = plan_carve_out(TARGET_CODES, {tech: ["500030", "500031", "500040"]})
    assert plan.moved == {tech}
    assert plan.trimmed == {}


def test_coverage_partly_inside_is_trimmed() -> None:
    tech = uuid.uuid4()
    plan = plan_carve_out(TARGET_CODES, {tech: ["500031", "500200"]})
    assert plan.moved == set()
    assert plan.trimmed == {tech: {"500031"}}


def test_coverage_disjoint_is_absent() -> None:
    tech = uuid.uuid4()
    assert plan_carve_out(TARGET_CODES, {tech: ["600001", "600002"]}) == CarvePlan()


def test_empty_coverage_is_absent() -> None:
    tech = uuid.uuid4()
    assert plan_carve_out(TARGET_CODES, {tech: []}) == CarvePlan()


def test_empty_codes_is_an_empty_plan() -> None:
    tech = uuid.uuid4()
    assert plan_carve_out([], {tech: ["500031"]}) == CarvePlan()


def test_five_mixed_technicians_partition() -> None:
    a, b, c, d, e = (uuid.uuid4() for _ in range(5))
    coverage = {
        a: ["500030", "500031"],                      # inside -> moved
        b: ["500032", "500200"],                      # straddles -> trimmed of 500032
        c: ["600001"],                                # disjoint -> absent
        d: [],                                        # nothing -> absent
        e: ["500033", "500034", "500035", "500036"],  # fully inside -> moved
    }
    plan = plan_carve_out(TARGET_CODES, coverage)
    assert plan.moved == {a, e}
    assert plan.trimmed == {b: {"500032"}}
    assert plan.moved & plan.trimmed.keys() == set()


def test_property_trimmed_technician_keeps_one_code() -> None:
    rng = random.Random(20261015)
    universe = [f"{500000 + i:06d}" for i in range(40)]
    for _ in range(200):
        codes = frozenset(rng.sample(universe, k=rng.randint(1, 15)))
        coverage = {
            f"t{n}": rng.sample(universe, k=rng.randint(1, 12))
            for n in range(rng.randint(1, 10))
        }
        plan = plan_carve_out(codes, coverage)
        assert plan.moved | plan.trimmed.keys() <= coverage.keys()
        for tid, losing in plan.trimmed.items():
            full = set(coverage[tid])
            assert set(losing) <= full & codes
            assert full - set(losing)  # keeps at least one code
            assert tid not in plan.moved


# ── diff_codes test 8 ──────────────────────────────────────────────────────


def test_diff_codes() -> None:
    assert diff_codes({"500001", "500002"}, {"500002", "500010"}) == (
        {"500010"},
        {"500001"},
    )
    assert diff_codes({"500001"}, {"500001"}) == (set(), set())
    # wanted = empty -> everything comes off (the deactivate path).
    assert diff_codes({"500001", "500002"}, set()) == (set(), {"500001", "500002"})


# ── find_clashes test 9 ───────────────────────────────────────────────────


def test_find_clashes() -> None:
    mine, other = uuid.uuid4(), uuid.uuid4()
    owners = {"500031": other, "500032": mine, "500150": other}
    # What I already own is not a clash; unowned is not a clash; others' is.
    assert find_clashes({"500031", "500032", "500033", "500150"}, owners, mine) == {
        "500031": other,
        "500150": other,
    }


# ── clash_lines / clash_summary tests 10-11 ───────────────────────────────


def _named_clashes() -> dict[str, str]:
    return {
        "500038": "SkyFix Services",
        "500039": "SkyFix Services",
        "500040": "SkyFix Services",
        "500120": "Acme Secunderabad",
    }


def test_clash_lines_sorted_and_cut() -> None:
    assert clash_lines(_named_clashes()) == [
        "500038 — SkyFix Services",
        "500039 — SkyFix Services",
        "500040 — SkyFix Services",
        "500120 — Acme Secunderabad",
    ]
    assert clash_lines(_named_clashes(), limit=2) == [
        "500038 — SkyFix Services",
        "500039 — SkyFix Services",
    ]


def test_clash_summary_grouped_by_owner_sorted_by_name() -> None:
    assert clash_summary(_named_clashes()) == (
        "500120 (Acme Secunderabad); 500038-500040 (SkyFix Services)"
    )
    assert clash_summary({}) == ""


def test_clash_summary_universe_aware() -> None:
    # With the active master as universe, a run reads the way it was typed.
    named = {f"{500001 + i:06d}": "Acme" for i in [0, 1, 3]}  # 500002 held by nobody
    assert clash_summary(named, universe=["500001", "500002", "500004"]) == (
        "500001-500004 (Acme)"
    )


def test_clash_summary_and_n_more_franchisees() -> None:
    named = {f"{600000 + i:06d}": f"House {i}" for i in range(7)}
    assert clash_summary(named, limit=5) == (
        "600000 (House 0); 600001 (House 1); 600002 (House 2);"
        " 600003 (House 3); 600004 (House 4); and 2 more franchisees"
    )


# ── ticket_moves test 12 ──────────────────────────────────────────────────


def test_ticket_moves() -> None:
    sky, home = uuid.uuid4(), uuid.uuid4()
    t1, t2, t3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows = [
        (t1, "500031", home),  # unassigned, pincode handed to SkyFix -> moves
        (t2, "500031", sky),   # already stamped the new owner -> unchanged
        (t3, "500200", home),  # pincode not in the change at all
    ]
    owner_after = {"500031": sky}
    assert ticket_moves(rows, owner_after) == [(t1, home, sky)]