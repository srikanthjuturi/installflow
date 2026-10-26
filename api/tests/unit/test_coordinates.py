"""Pins app.core.coordinates.metres_between / metres_label (00-index §4.1).

The test harness's own proof: these five cases exercise a pure function with
no database, and Task 10 (travel allowance) depends on this module behaving
exactly as documented here. This test documents current behaviour, it does
not redesign it.
"""

import pytest

from app.core.coordinates import metres_between, metres_label

HYDERABAD = (17.385, 78.4867)
BENGALURU = (12.9716, 77.5946)


def test_same_point_is_zero() -> None:
    lat, lon = HYDERABAD
    assert metres_between(lat, lon, lat, lon) == 0.0


def test_symmetric() -> None:
    lat1, lon1 = HYDERABAD
    lat2, lon2 = BENGALURU
    assert metres_between(lat1, lon1, lat2, lon2) == pytest.approx(
        metres_between(lat2, lon2, lat1, lon1)
    )


def test_hyderabad_to_bengaluru_is_about_500km() -> None:
    lat1, lon1 = HYDERABAD
    lat2, lon2 = BENGALURU
    distance = metres_between(lat1, lon1, lat2, lon2)
    assert distance == pytest.approx(500_000, rel=0.01)


def test_one_degree_of_latitude_is_about_111195_metres() -> None:
    # Spherical EARTH_RADIUS_M, as the module itself uses — pure latitude
    # change at a fixed longitude isolates the constant from the formula.
    distance = metres_between(0.0, 78.0, 1.0, 78.0)
    assert distance == pytest.approx(111_195, rel=0.005)


@pytest.mark.parametrize(
    "metres, expected",
    [
        (0, "0 m"),
        (420, "420 m"),
        (999, "999 m"),
        (1000, "1.0 km"),
        (1500, "1.5 km"),
        (4200, "4.2 km"),
    ],
)
def test_metres_label(metres: float, expected: str) -> None:
    assert metres_label(metres) == expected
