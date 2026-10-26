"""`app.core.accept_snapshot` — the frozen terms' pure half (10 §6 table).

Fakes are `SimpleNamespace`; nothing here touches a session. The loader
`build_accept_snapshot` needs a db and is proved on the dev database instead.
"""

import datetime
import uuid
from types import SimpleNamespace

import pytest

from app.core.accept_snapshot import (
    assemble,
    base_point,
    closure_travel_paise,
    customer_point,
    force_close_travel_paise,
    speed_of,
    technician_type_of,
    travel_of,
)
from app.core.travel import Point

TECH = uuid.uuid4()
OTHER = uuid.uuid4()
STAMP = datetime.datetime(2026, 10, 15, 5, 30, tzinfo=datetime.timezone.utc)

TRAVEL_BLOCK = {
    "basePoint": {"lat": 17.44, "lng": 78.35, "source": "pincode"},
    "customerPoint": {"lat": 17.41, "lng": 78.55, "source": "pincode"},
    "straightKm": 21.6, "roadFactorPct": 130, "km": 28.1,
    "freeKm": 20, "stepKm": 2, "paisePerStep": 1000, "maxPaisePerJob": 30000,
    "amountPaise": 4000, "reason": None,
}

FULL = {
    "acceptedAt": "2026-10-15T05:30:00Z",
    "technicianId": str(TECH),
    "franchiseeId": str(uuid.uuid4()),
    "technicianType": "freelancer",
    "travel": TRAVEL_BLOCK,
    "speed": None,
}


# ── customer_point ───────────────────────────────────────────────────────────


def test_ticket_point_wins() -> None:                         # snap test 1
    p = customer_point(17.4, 78.4, 17.0, 78.0)
    assert p == Point(lat=17.4, lng=78.4, source="ticket")


def test_pincode_centre_when_no_ticket_point() -> None:       # snap test 2
    p = customer_point(None, None, 17.0, 78.0)
    assert p == Point(lat=17.0, lng=78.0, source="pincode")


def test_nothing_at_all() -> None:                            # snap test 3
    assert customer_point(None, None, None, None) is None


def test_half_ticket_point_falls_through() -> None:           # snap test 4
    # A CHECK forbids this shape on the table; the pure function is defended
    # against it anyway — one coordinate alone is no point.
    p = customer_point(17.4, None, 17.0, 78.0)
    assert p == Point(lat=17.0, lng=78.0, source="pincode")


# ── base_point ───────────────────────────────────────────────────────────────


def test_base_point_of_a_set_base() -> None:                  # snap test 5
    tech = SimpleNamespace(base_latitude=17.44, base_longitude=78.35,
                           base_source="map")
    assert base_point(tech) == Point(lat=17.44, lng=78.35, source="map")


def test_base_point_of_no_base() -> None:                     # snap test 6
    assert base_point(SimpleNamespace(
        base_latitude=None, base_longitude=None, base_source=None,
    )) is None
    assert base_point(SimpleNamespace(
        base_latitude=17.44, base_longitude=None, base_source="gps",
    )) is None


# ── assemble ────────────────────────────────────────────────────────────────


def test_assemble_keys_and_stamp() -> None:                   # snap test 7
    snap = assemble(now=STAMP, technician_id=TECH,
                    franchisee_id=uuid.uuid4(),
                    technician_type="freelancer", travel=TRAVEL_BLOCK,
                    speed=None)
    assert set(snap) == {"acceptedAt", "technicianId", "franchiseeId",
                         "technicianType", "travel", "speed"}
    assert snap["speed"] is None
    assert isinstance(snap["technicianId"], str)
    assert snap["acceptedAt"].endswith("Z")
    parsed = datetime.datetime.fromisoformat(
        snap["acceptedAt"].replace("Z", "+00:00")
    )
    assert parsed == STAMP


def test_assemble_carries_the_frozen_speed_terms() -> None:   # snap test 7b (11 §4.3)
    block = {"ruleId": str(uuid.uuid4()), "matchedOn": "node",
             "matchedId": str(uuid.uuid4()), "rewardWithinHours": 12,
             "penaltyAfterHours": 24, "rewardPaise": 20000,
             "penaltyPaise": 15000}
    snap = assemble(now=STAMP, technician_id=TECH,
                    franchisee_id=uuid.uuid4(),
                    technician_type="freelancer", travel=TRAVEL_BLOCK,
                    speed=block)
    assert snap["speed"] == block


# ── travel_of reads anything without raising ────────────────────────────────


@pytest.mark.parametrize(
    "snapshot",
    [None, {}, {"travel": None}, "x", {"travel": []}],       # snap test 8
)
def test_travel_of_unreadable(snapshot: object) -> None:
    assert travel_of(snapshot) is None                       # no raise


@pytest.mark.parametrize(
    "amount",
    [None, "7000", -5, True, 7000.0],                         # snap test 9
)
def test_travel_of_only_a_real_int_is_money(amount: object) -> None:
    snap = {"technicianId": str(TECH), "travel": {**TRAVEL_BLOCK,
                                                  "amountPaise": amount}}
    assert travel_of(snap).amount_paise == 0


def test_travel_of_full_snapshot() -> None:                    # snap test 10
    view = travel_of(FULL)
    assert view.technician_id == str(TECH)
    assert view.amount_paise == 4000
    assert view.max_paise_per_job == 30000
    assert view.km == 28.1
    assert view.straight_km == 21.6
    assert view.reason is None
    assert view.base_source == "pincode"
    assert view.customer_source == "pincode"
    assert view.raw is TRAVEL_BLOCK


def test_speed_of_unreadable() -> None:                        # snap test 11
    # Superseded by Task 11's typed reader — §6 case 35 (test_speed.py) holds
    # the full parametrised version; this keeps the "never raises" contract
    # visible on the file the reader lives in.
    assert speed_of(None) is None
    assert speed_of({}) is None
    assert speed_of({"speed": None}) is None
    assert speed_of({"speed": {"ruleId": "x"}}) is None


# ── technician_type_of ──────────────────────────────────────────────────────


def test_type_none_snapshot_uses_fallback() -> None:           # snap test 12
    assert technician_type_of(None, "freelancer") == "freelancer"


def test_type_frozen_wins() -> None:
    assert technician_type_of({"technicianType": "employee"}, "freelancer") == "employee"


def test_type_unknown_value_uses_fallback() -> None:
    assert technician_type_of({"technicianType": "boss"}, "freelancer") == "freelancer"


# ── closure travel ──────────────────────────────────────────────────────────


def test_closure_pays_the_frozen_amount_to_the_holder() -> None:   # snap test 13
    assert closure_travel_paise(FULL, technician_id=TECH) == 4000


def test_closure_pays_nothing_to_anybody_else() -> None:            # snap test 14 (W17)
    assert closure_travel_paise(FULL, technician_id=OTHER) == 0


def test_closure_with_no_snapshot_pays_nothing() -> None:           # snap test 15
    assert closure_travel_paise(None, technician_id=TECH) == 0


# ── force-close travel ──────────────────────────────────────────────────────


def test_force_close_omitted_means_none() -> None:                  # snap test 16 (W5)
    assert force_close_travel_paise(FULL, technician_id=TECH,
                                    requested=None) == 0


def test_force_close_pays_the_manager_number() -> None:             # snap test 17
    assert force_close_travel_paise(FULL, technician_id=TECH,
                                    requested=5000) == 5000


def test_force_close_capped_at_the_frozen_max() -> None:            # snap test 18
    assert force_close_travel_paise(FULL, technician_id=TECH,
                                    requested=99999) == 30000


def test_force_close_zero_means_none() -> None:                     # snap test 19
    assert force_close_travel_paise(FULL, technician_id=TECH,
                                    requested=0) == 0


def test_force_close_cap_applies_without_a_frozen_amount() -> None:  # snap test 20 (TA6)
    # A snapshot whose reason was "no base" froze 0 paise — the cap is still
    # the ceiling the manager may pay up to.
    snap = {**FULL, "travel": {**TRAVEL_BLOCK, "amountPaise": 0,
                               "reason": "no_base_location"}}
    assert force_close_travel_paise(snap, technician_id=TECH,
                                    requested=10000) == 10000


def test_force_close_with_a_frozen_max_of_zero() -> None:           # snap test 21
    snap = {**FULL, "travel": {**TRAVEL_BLOCK, "maxPaisePerJob": 0}}
    assert force_close_travel_paise(snap, technician_id=TECH,
                                    requested=10000) == 0


def test_force_close_with_a_null_snapshot() -> None:                # snap test 22
    assert force_close_travel_paise(None, technician_id=TECH,
                                    requested=10000) == 0


def test_force_close_to_the_wrong_technician() -> None:             # snap test 23
    assert force_close_travel_paise(FULL, technician_id=OTHER,
                                    requested=10000) == 0