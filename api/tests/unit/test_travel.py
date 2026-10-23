"""`app.core.travel` — the allowance's arithmetic (10 §6 test table, cases 1–32).

Pure: the module itself imports no session, so this file never touches the X1
wall. Every case number in a comment names its row in the doc's table.
"""

import math

import pytest
from pydantic import ValidationError

from app.core.travel import (
    REASON_NO_BASE,
    REASON_NO_CUSTOMER,
    TRAVEL_DEFAULTS,
    TRAVEL_LIMITS,
    Point,
    TravelRule,
    compute_travel,
    road_km,
    travel_amount_paise,
)
from app.core.travel_rules import TravelRuleIO
from app.models.technician import TECHNICIAN_TYPES

TRAVEL_KEYS = {
    "basePoint", "customerPoint", "straightKm", "roadFactorPct", "km",
    "freeKm", "stepKm", "paisePerStep", "maxPaisePerJob", "amountPaise",
    "reason",
}


def rule(**overrides) -> TravelRule:
    base = dict(free_km=20, step_km=2, paise_per_step=1000,
                road_factor_pct=130, max_paise_per_job=10_000_000)
    return TravelRule(**{**base, **overrides})


# ── road_km ──────────────────────────────────────────────────────────────────


def test_road_km_worked_example() -> None:                    # test 1
    assert road_km(27_000, 130) == 35.1


def test_road_km_half_up() -> None:                           # test 18
    assert road_km(10_050, 100) == 10.1


def test_road_km_factor_100_is_straight() -> None:            # test 19
    assert road_km(12_345, 100) == 12.3


def test_road_km_factor_300() -> None:                        # test 20
    assert road_km(10_000, 300) == 30.0


def test_road_km_refuses_a_negative_distance() -> None:       # test 21 (last cell)
    with pytest.raises(ValueError):
        road_km(-1, 130)


# ── travel_amount_paise ──────────────────────────────────────────────────────


def test_worked_example_27km_at_130pct() -> None:             # test 2
    km = road_km(27_000, 130)                                 # 35.1
    assert travel_amount_paise(km, 20, 2, 1000, 30000) == 7000  # 7 steps


def test_index_35_example() -> None:                          # test 3
    km = road_km(21_600, 130)
    assert km == 28.1
    assert travel_amount_paise(km, 20, 2, 1000, 30000) == 4000


def test_exactly_at_free_km_pays_nothing() -> None:            # test 4
    assert travel_amount_paise(20.0, 20, 1, 1000, 10**7) == 0


def test_partial_step_just_past_free_is_dropped() -> None:    # test 5
    assert travel_amount_paise(20.9, 20, 1, 1000, 10**7) == 0


def test_exactly_one_step_pays_one_step() -> None:            # test 6
    assert travel_amount_paise(21.0, 20, 1, 1000, 10**7) == 1000


def test_exact_multiple_of_step() -> None:                    # test 7
    assert travel_amount_paise(24.0, 20, 2, 1000, 10**7) == 2000


def test_partial_step_dropped() -> None:                      # test 8
    assert travel_amount_paise(25.9, 20, 2, 1000, 10**7) == 2000


def test_step_larger_than_distance_past_free() -> None:       # test 9
    assert travel_amount_paise(25.0, 20, 10, 1000, 10**7) == 0


def test_below_free_is_never_negative() -> None:              # test 10
    assert travel_amount_paise(5.0, 20, 1, 1000, 10**7) == 0


def test_zero_km_pays_nothing() -> None:                      # test 11
    assert travel_amount_paise(0.0, 20, 2, 1000, 10**7) == 0


def test_cap_binds() -> None:                                 # test 12
    km = road_km(120_000, 130)                                # 156.0
    assert travel_amount_paise(km, 20, 2, 1000, 30000) == 30000


def test_cap_exactly_equal_to_the_computed_amount() -> None:  # test 13
    # 24.0 km, free 20, step 2, rate 1000 → 2000; a cap AT that figure is
    # reached, never cut below it.
    assert travel_amount_paise(24.0, 20, 2, 1000, 2000) == 2000


def test_rate_zero_pays_nothing() -> None:                    # test 14 (TA4 default)
    assert travel_amount_paise(120.0, 20, 1, 0, 10**7) == 0


def test_max_zero_pays_nothing() -> None:                     # test 15 (TA4 default)
    assert travel_amount_paise(120.0, 20, 1, 1000, 0) == 0


def test_float_drift_rounds_to_the_same_tenths() -> None:     # test 16
    assert travel_amount_paise(26.000000000000004, 20, 2, 1000, 10**7) == 3000
    assert travel_amount_paise(25.999999999999996, 20, 2, 1000, 10**7) == 3000


def test_free_zero_first_step_at_exactly_1km() -> None:       # test 17
    assert travel_amount_paise(0.9, 0, 1, 1000, 10**7) == 0
    assert travel_amount_paise(1.0, 0, 1, 1000, 10**7) == 1000


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(free_km=20, step_km=0, paise_per_step=1000, max_paise=10**7),  # test 21
        dict(free_km=20, step_km=2, paise_per_step=-1, max_paise=10**7),
        dict(free_km=20, step_km=2, paise_per_step=1000, max_paise=-1),
        dict(free_km=-1, step_km=2, paise_per_step=1000, max_paise=10**7),
    ],
)
def test_amount_refuses_out_of_range_inputs(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        travel_amount_paise(10.0, **kwargs)


def test_amount_refuses_a_negative_km() -> None:              # test 21 (km cell)
    with pytest.raises(ValueError):
        travel_amount_paise(-1.0, 20, 2, 1000, 10**7)


# ── TRAVEL_DEFAULTS and the shared bounds table ─────────────────────────────


def test_defaults_name_exactly_the_two_types() -> None:       # test 22
    assert set(TRAVEL_DEFAULTS) == set(TECHNICIAN_TYPES)


def test_defaults_are_the_doc_numbers() -> None:
    freelancer = TRAVEL_DEFAULTS["freelancer"]
    employee = TRAVEL_DEFAULTS["employee"]
    assert freelancer.free_km == 20
    assert employee.free_km == 30
    for both in (freelancer, employee):
        assert (both.step_km, both.road_factor_pct) == (1, 130)
        assert (both.paise_per_step, both.max_paise_per_job) == (0, 0)   # OFF


def test_every_default_inside_limits() -> None:               # test 23
    for ttype, trule in TRAVEL_DEFAULTS.items():
        for key, (low, high) in TRAVEL_LIMITS.items():
            value = getattr(trule, key)
            assert low <= value <= high, (ttype, key, value)


# ── TravelRuleIO mirrors the same table ─────────────────────────────────────


_WIRE_TO_KEY = {
    "freeKm": "free_km",
    "stepKm": "step_km",
    "paisePerStep": "paise_per_step",
    "roadFactorPct": "road_factor_pct",
    "maxPaisePerJob": "max_paise_per_job",
}


def _bounds(wire: str) -> tuple[int, int]:
    ge = [m.ge for m in TravelRuleIO.model_fields[wire].metadata if hasattr(m, "ge")]
    le = [m.le for m in TravelRuleIO.model_fields[wire].metadata if hasattr(m, "le")]
    return ge[0], le[0]


def test_travel_rule_io_bounds_are_travel_limits() -> None:   # test 24
    for wire, key in _WIRE_TO_KEY.items():
        assert _bounds(wire) == TRAVEL_LIMITS[key], wire


def test_rate_needs_a_cap() -> None:                          # test 25 (W2)
    with pytest.raises(ValidationError):
        TravelRuleIO(freeKm=20, stepKm=1, paisePerStep=1000,
                     roadFactorPct=130, maxPaisePerJob=0)
    # rate 0 with max 0 — the TA4 defaults — is a valid save.
    TravelRuleIO(freeKm=20, stepKm=1, paisePerStep=0, roadFactorPct=130,
                 maxPaisePerJob=0)


# ── compute_travel ───────────────────────────────────────────────────────────


def test_no_base_location() -> None:                          # test 26
    customer = Point(lat=17.4, lng=78.5, source="ticket")
    out = compute_travel(None, customer, rule())
    assert out["reason"] == REASON_NO_BASE
    assert out["km"] == 0.0
    assert out["straightKm"] == 0.0
    assert out["amountPaise"] == 0
    assert out["basePoint"] is None
    # The rates are recorded even then, so a force-closure can still pay to
    # the frozen cap.
    assert out["roadFactorPct"] == 130
    assert out["freeKm"] == 20
    assert out["stepKm"] == 2
    assert out["paisePerStep"] == 1000
    assert out["maxPaisePerJob"] == 10_000_000


def test_no_customer_point() -> None:                         # test 27
    base = Point(lat=17.44, lng=78.35, source="pincode")
    out = compute_travel(base, None, rule())
    assert out["reason"] == REASON_NO_CUSTOMER
    assert out["customerPoint"] is None
    assert out["basePoint"] == {"lat": 17.44, "lng": 78.35, "source": "pincode"}
    assert out["amountPaise"] == 0


def test_both_missing_reads_no_base() -> None:                # test 28 (W16)
    out = compute_travel(None, None, rule())
    assert out["reason"] == REASON_NO_BASE


def test_same_point_is_zero_km() -> None:                     # test 29
    p = Point(lat=17.44, lng=78.35, source="pincode")
    out = compute_travel(p, Point(lat=17.44, lng=78.35, source="ticket"),
                         rule(free_km=0))
    assert out["reason"] is None
    assert out["km"] == 0.0
    assert out["amountPaise"] == 0


def test_one_degree_of_latitude() -> None:                    # test 30
    base = Point(lat=17.0, lng=78.0, source="pincode")
    customer = Point(lat=18.0, lng=78.0, source="ticket")
    out = compute_travel(base, customer, rule())
    assert out["straightKm"] == pytest.approx(111.2, abs=0.2)
    # metresh_between is ~111_195 m; × 1.3, half-up to tenths.
    assert out["km"] == math.floor(111_195 * 130 / 10_000 + 0.5) / 10


def test_travel_block_keys_exactly() -> None:                 # test 31
    out = compute_travel(
        Point(lat=17.44, lng=78.35, source="pincode"),
        Point(lat=17.41, lng=78.55, source="ticket"),
        rule(),
    )
    assert set(out) == TRAVEL_KEYS


def test_point_sources_carried_through() -> None:             # test 32
    base = Point(lat=17.44, lng=78.35, source="pincode")
    customer = Point(lat=17.41, lng=78.55, source="ticket")
    out = compute_travel(base, customer, rule())
    assert out["basePoint"]["source"] == "pincode"
    assert out["customerPoint"]["source"] == "ticket"