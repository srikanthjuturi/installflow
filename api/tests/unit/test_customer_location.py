"""`app.core.customer_location` — the pure rules for the customer's own pin."""

import uuid

import pytest

from app.core.customer_location import (
    FAR_FROM_PINCODE_M,
    distance_note,
    may_customer_set,
    validate_point,
)
from app.core.errors import AppError


@pytest.mark.parametrize("lat,lng", [(17.44, 78.35), (6.0, 68.0), (38.0, 98.0)])
def test_point_inside_india_is_accepted(lat: float, lng: float) -> None:
    validate_point(lat, lng)


@pytest.mark.parametrize(
    "lat,lng",
    [(0.0, 0.0), (5.99, 78.0), (17.0, 98.01), (float("nan"), 78.0), (17.0, float("inf"))],
)
def test_point_outside_india_or_not_a_number_is_refused(lat: float, lng: float) -> None:
    with pytest.raises(AppError) as err:
        validate_point(lat, lng)
    assert err.value.status_code == 400


def test_unset_ticket_may_be_set() -> None:
    assert may_customer_set(None, None, "Slot Pending")


def test_vendor_point_may_be_overwritten_by_the_customer() -> None:
    assert may_customer_set("vendor", None, "New")


@pytest.mark.parametrize("source", ["customer", "staff"])
def test_customer_and_staff_points_are_locked(source: str) -> None:
    assert not may_customer_set(source, None, "New")


def test_a_held_job_cannot_be_set() -> None:
    assert not may_customer_set(None, uuid.uuid4(), "Assigned")


@pytest.mark.parametrize("status", ["Closed", "Force-Closed", "Cancelled"])
def test_a_finished_ticket_cannot_be_set(status: str) -> None:
    assert not may_customer_set(None, None, status)


def test_no_pincode_centre_gives_no_note() -> None:
    assert distance_note(17.44, 78.35, None, None) is None


def test_close_to_the_centre_gives_no_note() -> None:
    assert distance_note(17.44, 78.35, 17.45, 78.36) is None


def test_far_from_the_centre_is_noted() -> None:
    note = distance_note(17.44, 78.35, 18.5, 79.5)
    assert note is not None and "km from the pincode centre" in note
    assert FAR_FROM_PINCODE_M == 25_000


def test_unreadable_point_has_its_own_code() -> None:
    from app.features.tickets.slot_page import _parse_point

    with pytest.raises(AppError) as err:
        _parse_point("not-a-number", "78.4")
    assert err.value.code == "LOCATION_UNREADABLE"

    # Outside India keeps the box's own code; blank means "not set".
    with pytest.raises(AppError) as far:
        _parse_point("51.5", "-0.1")
    assert far.value.code == "BASE_OUTSIDE_INDIA"
    assert _parse_point("", "") is None
    assert _parse_point("17.4", "78.4") == (17.4, 78.4)
