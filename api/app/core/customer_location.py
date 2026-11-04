"""The customer's own location on their link — the rules, with no database.

The point is stored in `tickets.latitude` / `longitude`, which the travel
allowance and the live-photo check already read, so nothing downstream changes.
What this module decides is WHO may write it and WHEN, and what is worth
saying about a point that looks far from where the pincode says it should be.
"""

from app.core.base_location import check_in_india
from app.core.coordinates import metres_between, metres_label
from app.core.tickets import TERMINAL_STATUSES

SOURCE_VENDOR = "vendor"
SOURCE_CUSTOMER = "customer"
SOURCE_STAFF = "staff"
LOCATION_SOURCES = (SOURCE_VENDOR, SOURCE_CUSTOMER, SOURCE_STAFF)

#: Past this far from the pincode's centre the event note says so. A pincode
#: has a centre in the master and no boundary, so distance is the only honest
#: test — and it is a note, never a refusal: the address and the pincode can be
#: the wrong half, and the customer's pin is exactly the correction.
FAR_FROM_PINCODE_M = 25_000


def validate_point(lat: float, lng: float) -> None:
    """Raises `AppError` (400 `BASE_OUTSIDE_INDIA`) for a point outside India.

    A non-finite value is refused as well: a NaN compares false against both
    bounds, and would otherwise be stored.
    """
    for value in (lat, lng):
        if value != value or value in (float("inf"), float("-inf")):
            # Same code and words as the box itself, so a client translates one.
            check_in_india(0.0, 0.0)
    check_in_india(lat, lng)


def may_customer_set(
    source: str | None, technician_id: object | None, status: str
) -> bool:
    """Whether the customer may save their location now.

    One-time: once the customer's own point is on the ticket it is theirs and
    locked. A vendor's pick may be overwritten — the customer knows where they
    live — but a STAFF correction may not: somebody senior looked at it. And
    never once a technician holds the job (the travel figure is frozen at
    accept) or the ticket is finished.
    """
    if source in (SOURCE_CUSTOMER, SOURCE_STAFF):
        return False
    if technician_id is not None:
        return False
    return status not in TERMINAL_STATUSES


def distance_note(
    lat: float,
    lng: float,
    pin_lat: float | None,
    pin_lng: float | None,
) -> str | None:
    """A line for the ticket trail when the point is far from its pincode.

    None when the pincode has no centre in the master (about 300 of them have
    none) — never a guess — and when the point is close enough.
    """
    if pin_lat is None or pin_lng is None:
        return None
    away = metres_between(lat, lng, pin_lat, pin_lng)
    if away <= FAR_FROM_PINCODE_M:
        return None
    return f"{metres_label(away)} from the pincode centre"
