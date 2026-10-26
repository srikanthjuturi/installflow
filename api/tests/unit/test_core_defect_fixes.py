"""Regression tests for four core defects — all pure, no database.

* `resolve_base` called `.one_or_none()` on the un-awaited `execute` coroutine
  on the pincode path.
* `travel_rules._to_io` — the camelCase schema cannot be `model_validate`d off a
  snake_case ORM row.
* `speed_rules._rule_outs` / `_one_out` read a `db` they were never given.
* `owner_names_by_pincode` — `outside_message` looks owners up by PINCODE.
"""

import asyncio
import datetime
import uuid
from types import SimpleNamespace

import pytest

from app.core import speed_rules
from app.core.base_location import resolve_base
from app.core.errors import AppError
from app.core.franchise_routing import outside_message, owner_names_by_pincode
from app.core.travel_rules import TravelRuleIO, _to_io
from app.models.franchisee import FranchiseeTravelRule


# ── base_location: the pincode path ──────────────────────────────────────────


class _Result:
    def __init__(self, row):
        self._row = row

    def one_or_none(self):
        return self._row


class _BaseDb:
    """`execute` is a coroutine, as on a real AsyncSession."""

    def __init__(self, row, *, is_home=False):
        self._row = row
        self._is_home = is_home

    async def scalar(self, _stmt):
        return self._is_home

    async def execute(self, _stmt):
        return _Result(self._row)


def _pincode_body(code="500001"):
    return SimpleNamespace(pincode=code, source=None, latitude=None, longitude=None)


@pytest.mark.parametrize("is_home", [False, True])
def test_pincode_source_awaits_the_execute_before_reading_the_row(is_home) -> None:
    # Both branches of `franchisee_pincodes_subquery`: its one column is
    # `pincode` for a franchisee and `code` for home.
    fix = asyncio.run(
        resolve_base(
            _BaseDb((17.4, 78.4), is_home=is_home), company_id=uuid.uuid4(),
            franchisee_id=uuid.uuid4(), body=_pincode_body(),
            allowed=("pincode",),
        )
    )
    assert (fix.latitude, fix.longitude, fix.pincode, fix.source) == (
        17.4, 78.4, "500001", "pincode",
    )


def test_pincode_source_outside_the_franchisee_is_the_422_not_an_attribute_error() -> None:
    with pytest.raises(AppError) as err:
        asyncio.run(
            resolve_base(
                _BaseDb(None), company_id=uuid.uuid4(),
                franchisee_id=uuid.uuid4(), body=_pincode_body(),
                allowed=("pincode",),
            )
        )
    assert err.value.code == "PINCODE_OUTSIDE_FRANCHISEE"


# ── travel_rules: one row → the wire shape ───────────────────────────────────


def test_to_io_maps_every_column_to_its_camel_case_field() -> None:
    row = FranchiseeTravelRule(
        free_km=20, step_km=5, paise_per_step=1500, road_factor_pct=130,
        max_paise_per_job=30000,
    )
    io = _to_io(row)
    assert isinstance(io, TravelRuleIO)
    assert io.freeKm == 20
    assert io.stepKm == 5
    assert io.paisePerStep == 1500
    assert io.roadFactorPct == 130
    assert io.maxPaisePerJob == 30000


def test_to_io_accepts_any_row_shaped_object() -> None:
    row = SimpleNamespace(
        free_km=30, step_km=1, paise_per_step=0, road_factor_pct=100,
        max_paise_per_job=0,
    )
    assert _to_io(row).model_dump() == {
        "freeKm": 30, "stepKm": 1, "paisePerStep": 0,
        "roadFactorPct": 100, "maxPaisePerJob": 0,
    }


def test_model_validate_on_the_row_is_the_bug_this_replaces() -> None:
    row = SimpleNamespace(
        free_km=30, step_km=1, paise_per_step=0, road_factor_pct=100,
        max_paise_per_job=0,
    )
    with pytest.raises(Exception):
        TravelRuleIO.model_validate(row)


# ── speed_rules: _rule_outs / _one_out get their session ─────────────────────


class _SpeedDb:
    """Answers the sibling-rule read with `siblings` and every other read (the
    node and model masters) with nothing, so a rule's target reads as gone."""

    def __init__(self, siblings):
        self._siblings = siblings

    async def scalars(self, stmt):
        if "franchisee_speed_rules" in str(stmt):
            return list(self._siblings)
        return []


def _speed_row(company_id, franchisee_id):
    return SimpleNamespace(
        id=uuid.uuid4(), company_id=company_id, franchisee_id=franchisee_id,
        technician_type="freelancer", node_id=uuid.uuid4(), model_id=None,
        reward_within_hours=2, penalty_after_hours=6, reward_paise=5000,
        penalty_paise=2000, updated_at=datetime.datetime(2026, 1, 1),
    )


def test_one_out_uses_the_session_it_is_given() -> None:
    row = _speed_row(uuid.uuid4(), uuid.uuid4())
    out = asyncio.run(speed_rules._one_out(_SpeedDb([row]), row))
    assert out.id == row.id
    assert out.rewardPaise == 5000


def test_rule_outs_takes_the_session_first() -> None:
    company = uuid.uuid4()
    row = _speed_row(company, uuid.uuid4())
    outs = asyncio.run(
        speed_rules._rule_outs(_SpeedDb([]), [row], company_id=company)
    )
    assert set(outs) == {row.id}


# ── franchise: owner names are keyed by PINCODE ──────────────────────────────


def test_owner_names_by_pincode_names_the_owner_in_the_staff_sentence() -> None:
    skyfix = uuid.uuid4()
    routes = {"500032": skyfix, "500033": skyfix}
    names = {skyfix: "SkyFix Services"}
    outside = ["500032", "500033"]

    keyed = owner_names_by_pincode(outside, routes, names)
    assert keyed == {"500032": "SkyFix Services", "500033": "SkyFix Services"}
    assert outside_message("Acme Home", outside, owner_names=keyed) == (
        "Outside Acme Home: 500032, 500033 (SkyFix Services). "
        "Pick pincodes Acme Home owns."
    )


def test_a_franchisee_id_keyed_dict_never_names_the_owner() -> None:
    skyfix = uuid.uuid4()
    got = outside_message(
        "Acme Home", ["500032", "500033"], owner_names={skyfix: "SkyFix Services"}
    )
    assert "SkyFix" not in got
    assert "(" not in got


def test_owner_names_by_pincode_skips_codes_with_no_known_owner() -> None:
    skyfix = uuid.uuid4()
    assert owner_names_by_pincode(
        ["500032", "500099"], {"500032": skyfix}, {skyfix: "SkyFix Services"}
    ) == {"500032": "SkyFix Services"}
