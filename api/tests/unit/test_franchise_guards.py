"""Task 02 §6 cases 4–7 — `Principal.is_franchise` and the three guards.

Pure: the guards are sync role tests, so a constructed `Principal` answers
everything and no database is touched (X1).
"""

import uuid

import pytest
from fastapi import HTTPException

from app.core.deps import (
    Principal,
    require_facility_principal,
    require_franchise_principal,
    require_staff_principal,
)
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    FRANCHISE_ROLES,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_RANKS,
    TECHNICIAN,
    VENDOR,
    VENDOR_USER,
)
from app.models.user import User

_FRANCHISEE = uuid.uuid4()
_VENDOR_ID = uuid.uuid4()
_COMPANY = uuid.uuid4()


def _principal(role: str, *, franchisee_id: uuid.UUID | None = None) -> Principal:
    vendor_id = _VENDOR_ID if role in (VENDOR, VENDOR_USER) else None
    return Principal(
        user=User(id=uuid.uuid4(), role=role),
        role=role,
        rank=ROLE_RANKS[role],
        is_superadmin=False,
        company_id=_COMPANY,
        vendor_id=vendor_id,
        franchisee_id=franchisee_id,
    )


def test_is_franchise_true_only_for_the_three() -> None:
    assert _principal(FRANCHISEE_ADMIN).is_franchise
    assert _principal(FACILITY_ADMIN).is_franchise
    assert _principal(FACILITY_OPERATOR).is_franchise
    for role in ROLE_RANKS:
        if role in FRANCHISE_ROLES:
            continue
        assert not _principal(role).is_franchise, role


# ── require_franchise_principal: the franchisee ADMIN only ──────────────────


def test_franchise_principal_admits_the_admin() -> None:
    assert (
        require_franchise_principal(
            _principal(FRANCHISEE_ADMIN, franchisee_id=_FRANCHISEE)
        ).franchisee_id
        == _FRANCHISEE
    )


def test_franchise_principal_refuses_an_unlinked_admin() -> None:
    with pytest.raises(HTTPException) as exc:
        require_franchise_principal(_principal(FRANCHISEE_ADMIN, franchisee_id=None))
    assert exc.value.status_code == 403
    assert "not linked" in exc.value.detail


@pytest.mark.parametrize(
    "role",
    [
        FACILITY_ADMIN,
        FACILITY_OPERATOR,
        ADMIN,
        NATIONAL_HEAD,
        VENDOR,
        TECHNICIAN,
    ],
)
def test_franchise_principal_refuses_everything_else(role: str) -> None:
    with pytest.raises(HTTPException) as exc:
        require_franchise_principal(_principal(role, franchisee_id=_FRANCHISEE))
    assert exc.value.status_code == 403


# ── require_facility_principal: ANY franchise role ──────────────────────────


@pytest.mark.parametrize("role", list(FRANCHISE_ROLES))
def test_facility_principal_admits_all_three(role: str) -> None:
    returned = require_facility_principal(
        _principal(role, franchisee_id=_FRANCHISEE)
    )
    assert returned.franchisee_id == _FRANCHISEE


@pytest.mark.parametrize("role", list(FRANCHISE_ROLES))
def test_facility_principal_refuses_an_unlinked_login(role: str) -> None:
    with pytest.raises(HTTPException) as exc:
        require_facility_principal(_principal(role, franchisee_id=None))
    assert exc.value.status_code == 403
    assert "not linked" in exc.value.detail


@pytest.mark.parametrize(
    "role", [ADMIN, NATIONAL_HEAD, AREA_MANAGER, VENDOR, TECHNICIAN]
)
def test_facility_principal_refuses_staff_and_others(role: str) -> None:
    with pytest.raises(HTTPException):
        require_facility_principal(_principal(role))


# ── require_staff_principal: franchise roles now refused too ────────────────


@pytest.mark.parametrize("role", list(FRANCHISE_ROLES) + [VENDOR, VENDOR_USER, TECHNICIAN])
def test_staff_principal_refuses_non_staff(role: str) -> None:
    with pytest.raises(HTTPException):
        require_staff_principal(_principal(role))


@pytest.mark.parametrize(
    "role", [ADMIN, NATIONAL_HEAD, REGIONAL_HEAD, AREA_MANAGER]
)
def test_staff_principal_admits_staff(role: str) -> None:
    assert require_staff_principal(_principal(role)).role == role