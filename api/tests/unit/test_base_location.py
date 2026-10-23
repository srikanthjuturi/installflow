"""`app.core.base_location` pure half + Earnings `_title` (10 §6, cases 1–6).

The db-dependent half (`resolve_base`'s pincode branches) is proved against
the dev database at acceptance; what is unit-tested is everything that needs
no session. Case numbers in comments name the doc's rows.
"""

import pytest
from pydantic import ValidationError

from app.core.base_location import (
    BaseLocationIn,
    check_in_india,
    check_source_allowed,
)
from app.core.errors import AppError
from app.core.ledger import travel_reason
from app.features.earnings.service import _title


# ── India box ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("lat,lng", [(6.0, 68.0), (38.0, 98.0)])  # case 1
def test_corners_inside_india(lat: float, lng: float) -> None:
    check_in_india(lat, lng)          # no raise


@pytest.mark.parametrize(
    "lat,lng", [(5.99, 78.0), (38.01, 78.0), (17.0, 67.99), (17.0, 98.01), (0.0, 0.0)]
)                                                                      # case 2
def test_outside_india_is_a_400_code(lat: float, lng: float) -> None:
    with pytest.raises(AppError) as err:
        check_in_india(lat, lng)
    assert err.value.code == "BASE_OUTSIDE_INDIA"
    assert err.value.status_code == 400


# ── BaseLocationIn shape ─────────────────────────────────────────────────────


def test_pincode_only_is_valid() -> None:                               # case 3
    BaseLocationIn(pincode="500081")


def test_point_with_source_is_valid() -> None:
    BaseLocationIn(latitude=17.44, longitude=78.35, source="gps")


@pytest.mark.parametrize(
    "body",
    [
        dict(pincode="500081", latitude=17.44),                       # pincode + a stray
        dict(pincode="500081", longitude=78.35),
        dict(pincode="500081", source="gps"),
        dict(latitude=17.44),                                         # lat without lng
        dict(longitude=78.35),                                        # lng without lat
        dict(latitude=17.44, longitude=78.35),                        # point without source
    ],
)
def test_half_shapes_are_422(body: dict) -> None:
    with pytest.raises(ValidationError):
        BaseLocationIn(**body)


def test_nothing_is_422() -> None:                                      # case 3
    with pytest.raises(ValidationError):
        BaseLocationIn()


def test_pincode_shape_is_six_digits() -> None:                         # case 3
    with pytest.raises(ValidationError):
        BaseLocationIn(pincode="05000")                                 # 5 chars


# ── source gates ─────────────────────────────────────────────────────────────


def _body(source: str):
    from types import SimpleNamespace

    return SimpleNamespace(pincode=None, source=source)


def test_the_technician_cannot_claim_manual() -> None:                  # case 4 (W8)
    with pytest.raises(AppError) as err:
        check_source_allowed(_body("manual"), ("pincode", "gps", "map"))
    assert err.value.code == "SOURCE_NOT_ALLOWED"
    assert err.value.status_code == 422


def test_the_manager_cannot_claim_gps() -> None:
    with pytest.raises(AppError) as err:
        check_source_allowed(_body("gps"), ("pincode", "map", "manual"))
    assert err.value.code == "SOURCE_NOT_ALLOWED"


@pytest.mark.parametrize(
    "source,allowed",
    [
        ("gps", ("pincode", "gps", "map")),
        ("map", ("pincode", "gps", "map")),
        ("map", ("pincode", "map", "manual")),
        ("manual", ("pincode", "map", "manual")),
        ("pincode", ("pincode", "gps", "map")),   # a pincode base, either door
    ],
)
def test_honest_sources_pass(source: str, allowed: tuple) -> None:
    check_source_allowed(_body(source), allowed)          # no raise


# ── Earnings titles (case 6) ─────────────────────────────────────────────────


def test_travel_title_is_a_fixed_string() -> None:
    assert _title("travel", "Travel allowance · 35.1 km") == "Travel allowance"
    assert _title("travel", "anything else") == "Travel allowance"


def test_travel_title_is_never_a_penalty_title() -> None:
    assert _title("travel", "") not in (
        "Late cancellation penalty", "No-show penalty",
    )


def test_penalty_titles_unchanged() -> None:
    assert _title("penalty", "Cancel < 2h before slot") == "Late cancellation penalty"
    assert _title("penalty", "No-show") == "No-show penalty"


def test_unknown_kind_returns_its_reason() -> None:
    assert _title("speed_reward", "Under 12h") == "Under 12h"


# ── travel_reason (case 5) ───────────────────────────────────────────────────


def test_closure_reason_quotes_km() -> None:
    assert travel_reason(km=35.1) == "Travel allowance · 35.1 km"
    assert len(travel_reason(km=999_999.0)) <= 160


def test_force_close_reason_quotes_no_km() -> None:
    reason = travel_reason(km=None, force_closed=True)
    assert reason == "Travel allowance · set at force-closure"
    assert " km" not in reason
    assert len(reason) <= 160