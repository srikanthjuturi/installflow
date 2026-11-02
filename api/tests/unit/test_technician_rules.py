"""`app.core.technician_rules` -- the pure half of per-technician overrides (Epic 3)."""

import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core import technician_rules as tr
from app.core.accept_snapshot import assemble, speed_of
from app.core.travel import TravelRule
from app.features.technicians.rules_schemas import TechnicianRulesIn
import datetime

TECH = uuid.uuid4()
RULE = TravelRule(free_km=20, step_km=1, paise_per_step=100, road_factor_pct=130, max_paise_per_job=5000)


def row(**kw):
    base = dict(
        technician_id=TECH, payout_percent=None, cancel_penalties_paise=None,
        bonus_bands_paise=None, speed_reward_within_hours=None,
        speed_penalty_after_hours=None, speed_reward_paise=None,
        speed_penalty_paise=None, travel_free_km=None, travel_paise_per_step=None,
        travel_max_paise_per_job=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_no_row_and_empty_row_are_the_same_snapshot():
    assert tr.build_overrides(None) is None
    assert tr.build_overrides(row()) is None


def test_only_set_overrides_are_frozen():
    out = tr.build_overrides(row(payout_percent=120, bonus_bands_paise=[1, 2, 3, 4]))
    assert out == {"payoutPercent": 120, "bonusBandsPaise": [1, 2, 3, 4]}


def test_a_snapshot_without_overrides_is_untouched():
    snap = assemble(
        now=datetime.datetime.now(datetime.timezone.utc), technician_id=TECH,
        franchisee_id=uuid.uuid4(), technician_type="freelancer", travel={}, speed=None,
    )
    assert "overrides" not in snap
    with_over = assemble(
        now=datetime.datetime.now(datetime.timezone.utc), technician_id=TECH,
        franchisee_id=uuid.uuid4(), technician_type="freelancer", travel={}, speed=None,
        overrides={"payoutPercent": 110},
    )
    assert tr.payout_percent_of(with_over) == 110


@pytest.mark.parametrize("snap", [None, {}, {"overrides": None}, {"overrides": "x"},
                                  {"overrides": {"payoutPercent": True}},
                                  {"overrides": {"payoutPercent": 0}},
                                  {"overrides": {"payoutPercent": 9999}},
                                  {"overrides": {"cancelPenaltiesPaise": [1, 2]}},
                                  {"overrides": {"bonusBandsPaise": ["a", 1, 2, 3]}}])
def test_readers_never_raise_on_junk(snap):
    assert tr.payout_percent_of(snap) is None
    assert tr.cancel_penalties_of(snap) is None
    assert tr.bonus_bands_of(snap) is None


def test_paid_amount_rounds_half_up_and_never_erases_pay():
    assert tr.paid_amount(45000, None) == 45000
    assert tr.paid_amount(45000, 100) == 45000
    assert tr.paid_amount(45000, 120) == 54000
    assert tr.paid_amount(101, 50) == 51  # 50.5 rounds up
    assert tr.paid_amount(1, 1) == 1  # never to zero for a positive stamp


def test_penalty_bands_prefer_the_holders_frozen_override():
    ticket = SimpleNamespace(
        rules_snapshot={"cancel_penalties_paise": [300, 500, 800, 1200]},
        accept_snapshot={"overrides": {"cancelPenaltiesPaise": [100, 200, 300, 400]}},
    )
    assert tr.penalty_bands_for(ticket) == [100, 200, 300, 400]
    ticket.accept_snapshot = None
    assert tr.penalty_bands_for(ticket) == [300, 500, 800, 1200]


def test_travel_override_lays_over_only_the_fields_set():
    assert tr.apply_to_travel(RULE, None) == RULE
    out = tr.apply_to_travel(RULE, row(travel_free_km=5, travel_max_paise_per_job=9000))
    assert (out.free_km, out.paise_per_step, out.max_paise_per_job) == (5, 100, 9000)
    assert out.road_factor_pct == 130


def test_technician_speed_terms_round_trip_through_the_snapshot():
    terms = tr.speed_terms(row(
        speed_reward_within_hours=2, speed_penalty_after_hours=8,
        speed_reward_paise=5000, speed_penalty_paise=3000,
    ))
    assert terms is not None and terms.matched_on == "technician"
    snap = {"speed": {
        "ruleId": None, "matchedOn": terms.matched_on, "matchedId": str(terms.matched_id),
        "rewardWithinHours": 2, "penaltyAfterHours": 8, "rewardPaise": 5000, "penaltyPaise": 3000,
    }}
    assert speed_of(snap) == terms
    assert tr.speed_terms(row()) is None


def test_redeemable_after_holding():
    assert tr.redeemable_after_holding(10000, 4000) == 6000
    assert tr.redeemable_after_holding(1000, 4000) == 0
    assert tr.redeemable_after_holding(-500, 0) == 0


def test_rules_body_validation():
    TechnicianRulesIn()  # everything inherits
    TechnicianRulesIn(payoutPercent=110, cancelPenaltiesPaise=[1, 2, 3, 4])
    for bad in (
        dict(payoutPercent=0),
        dict(payoutPercent=301),
        dict(cancelPenaltiesPaise=[1, 2, 3]),
        dict(bonusBandsPaise=[0, 1, 2, 3]),
        dict(speedRewardWithinHours=2),  # speed is all four or none
        dict(speedRewardWithinHours=9, speedPenaltyAfterHours=3,
             speedRewardPaise=1, speedPenaltyPaise=1),
    ):
        with pytest.raises(ValidationError):
            TechnicianRulesIn(**bad)
