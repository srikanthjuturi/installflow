"""Task 02 §6 cases 8–11 — the F7/F8 decision table, pure.

`managed_franchisee_ids` / `can_manage_technician` touch a database and are
proven by Task 05's acceptance criteria (X1); the two PURE functions underneath
are pinned here — one per table cell, all roles × three purposes.
"""

import uuid

import pytest

from app.core.franchise_scope import (
    MANAGE,
    REVERSE,
    VIEW,
    decide_can_manage,
    decide_managed_franchisees,
)
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    SUPERADMIN,
    TECHNICIAN,
    VENDOR,
    VENDOR_USER,
)

_HOME = uuid.uuid4()
_OWN = uuid.uuid4()
_EVERY_ROLE = [
    ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    AREA_MANAGER,
    FRANCHISEE_ADMIN,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    TECHNICIAN,
    VENDOR,
    VENDOR_USER,
    SUPERADMIN,
]


def _expected(role: str, purpose: str) -> frozenset | None:
    """The table in franchise_scope's docstring, written out independently."""
    if role == FRANCHISEE_ADMIN:
        return frozenset({_OWN})
    if role in (ADMIN, NATIONAL_HEAD):
        return None if purpose in (VIEW, REVERSE) else frozenset({_HOME})
    if role in (REGIONAL_HEAD, AREA_MANAGER):
        return None if purpose == VIEW else frozenset({_HOME})
    return frozenset()


@pytest.mark.parametrize("role", _EVERY_ROLE)
@pytest.mark.parametrize("purpose", [MANAGE, VIEW, REVERSE])
def test_full_table(role: str, purpose: str) -> None:
    assert (
        decide_managed_franchisees(
            role=role, principal_franchisee_id=_OWN, home_id=_HOME, purpose=purpose
        )
        == _expected(role, purpose)
    )


def test_home_franchisee_admin_is_home_for_every_purpose() -> None:
    # F8: the HOME's own admin lands in the same row as its staff's admin —
    # {home} rather than {own-as-other}, for all three purposes.
    for purpose in (MANAGE, VIEW, REVERSE):
        assert (
            decide_managed_franchisees(
                role=FRANCHISEE_ADMIN,
                principal_franchisee_id=_HOME,
                home_id=_HOME,
                purpose=purpose,
            )
            == frozenset({_HOME})
        )


def test_franchisee_admin_without_a_franchisee_reaches_nothing() -> None:
    assert (
        decide_managed_franchisees(
            role=FRANCHISEE_ADMIN,
            principal_franchisee_id=None,
            home_id=_HOME,
            purpose=MANAGE,
        )
        == frozenset()
    )


def test_unknown_purpose_is_value_error() -> None:
    with pytest.raises(ValueError):
        decide_managed_franchisees(
            role=ADMIN, principal_franchisee_id=_OWN, home_id=_HOME, purpose="steal"
        )


def test_decide_can_manage() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert decide_can_manage(None, a) is True      # unbounded staff
    assert decide_can_manage(frozenset({a}), a) is True
    assert decide_can_manage(frozenset({a}), b) is False
    assert decide_can_manage(frozenset(), a) is False  # an explicit empty wall