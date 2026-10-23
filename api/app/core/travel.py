"""Travel allowance — the arithmetic and nothing else.

PURE: no database, no I/O, no clock. Everything that needs a session lives in
`core.travel_rules` (rules) and `core.accept_snapshot` (stamping), so this file
is unit-tested in full under `api/tests/unit/test_travel.py`.

Distance is one way, base → customer, straight line × a road factor (TA1).
Partial steps are dropped (TA3). Done in integer TENTHS of a km (W1): the km a
technician is shown is exactly the km they are paid for.
"""

import math
from dataclasses import dataclass

from app.core.coordinates import metres_between

#: Inclusive bounds — the model CHECKs, the pydantic Fields and the tests read
#: this one table (the `core.rules.LIMITS` shape).
TRAVEL_LIMITS: dict[str, tuple[int, int]] = {
    "free_km": (0, 500),
    "step_km": (1, 50),
    "paise_per_step": (0, 1_000_000),
    "road_factor_pct": (100, 300),
    "max_paise_per_job": (0, 10_000_000),
}

REASON_NO_BASE = "no_base_location"
REASON_NO_CUSTOMER = "no_customer_point"


@dataclass(frozen=True)
class TravelRule:
    free_km: int
    step_km: int
    paise_per_step: int
    road_factor_pct: int
    max_paise_per_job: int


#: TA4. Stamped onto every new franchisee (two rows) by `core.travel_rules`.
#: ₹0 per step and ₹0 max: OFF until a franchisee admin configures it.
TRAVEL_DEFAULTS: dict[str, TravelRule] = {
    "freelancer": TravelRule(free_km=20, step_km=1, paise_per_step=0,
                             road_factor_pct=130, max_paise_per_job=0),
    "employee": TravelRule(free_km=30, step_km=1, paise_per_step=0,
                           road_factor_pct=130, max_paise_per_job=0),
}


@dataclass(frozen=True)
class Point:
    lat: float
    lng: float
    #: base: pincode | gps | map | manual · customer: ticket | pincode
    source: str


def _tenths(km: float) -> int:
    """Half-up to integer tenths of a km. 26.000000000000004 → 260."""
    return math.floor(km * 10 + 0.5)


def road_km(straight_m: float, road_factor_pct: int) -> float:
    """Straight metres × factor, as km rounded half-up to 0.1."""
    if straight_m < 0 or road_factor_pct < 1:
        raise ValueError("distance and factor must be positive")
    return math.floor(straight_m * road_factor_pct / 10_000 + 0.5) / 10


def travel_amount_paise(
    km: float, free_km: int, step_km: int, paise_per_step: int, max_paise: int
) -> int:
    """TA3: min(max, floor(max(0, km − free) / step) × rate). Never negative."""
    if km < 0 or free_km < 0 or step_km < 1 or paise_per_step < 0 or max_paise < 0:
        raise ValueError("travel inputs out of range")
    beyond = max(0, _tenths(km) - free_km * 10)
    steps = beyond // (step_km * 10)
    return min(max_paise, steps * paise_per_step)


def compute_travel(base: Point | None, customer: Point | None, rule: TravelRule) -> dict:
    """The `travel` block of `accept_snapshot` (index §3.5), exactly its keys.

    A missing point is 0 km with a reason (TA2, TA8) — never a guess, and never
    a refusal: the job is still accepted. The RATES are recorded even then, so a
    force-closure can still pay up to the frozen cap.
    """
    reason = REASON_NO_BASE if base is None else (
        REASON_NO_CUSTOMER if customer is None else None
    )
    if reason is None:
        straight_m = metres_between(base.lat, base.lng, customer.lat, customer.lng)
        straight_km = math.floor(straight_m / 100 + 0.5) / 10
        km = road_km(straight_m, rule.road_factor_pct)
    else:
        straight_km = km = 0.0
    return {
        "basePoint": _point(base),
        "customerPoint": _point(customer),
        "straightKm": straight_km,
        "roadFactorPct": rule.road_factor_pct,
        "km": km,
        "freeKm": rule.free_km,
        "stepKm": rule.step_km,
        "paisePerStep": rule.paise_per_step,
        "maxPaisePerJob": rule.max_paise_per_job,
        "amountPaise": travel_amount_paise(
            km, rule.free_km, rule.step_km, rule.paise_per_step, rule.max_paise_per_job
        ),
        "reason": reason,
    }


def _point(p: Point | None) -> dict | None:
    return None if p is None else {"lat": p.lat, "lng": p.lng, "source": p.source}


__all__ = [
    "REASON_NO_BASE",
    "REASON_NO_CUSTOMER",
    "TRAVEL_DEFAULTS",
    "TRAVEL_LIMITS",
    "Point",
    "TravelRule",
    "compute_travel",
    "road_km",
    "travel_amount_paise",
]