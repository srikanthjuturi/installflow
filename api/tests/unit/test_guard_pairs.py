"""Every guard of a formerly stacked pair now RUNS (api/AGENTS.md, hard rule 2).

`Annotated[Principal, Depends(a), Depends(b)]` used to run only `b`. Each alias is
now one `require_all(wall, feature[, floor])`; these tests drive the REAL app
with the principal-loading dependency overridden to return a crafted `Principal`,
the database dependency replaced by a bare object, and the feature lookup stubbed
to a list - so no database is touched (X1) - and prove, per representative route:

(i)   the right kind of principal, the rank floor met, but the feature key OFF
      -> 403 "Missing feature";
(ii)  the feature held but the rank floor missed, or the wrong family (a franchise
      login on a staff door, staff on a franchise twin) -> 403;
(iii) everything in order -> the guards let the request through. The endpoint
      body then meets the stub database (or an empty body) and answers 422/500;
      what is asserted is only that it is NOT 401/403.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import app.core.deps as deps
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import Principal, get_current_principal
from app.main import app
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FRANCHISE_ROLES,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_RANKS,
    TECHNICIAN,
    VENDOR,
)
from app.models.user import User

PREFIX = settings.API_V1_PREFIX
_ID = uuid.uuid4()
_COMPANY = uuid.uuid4()
_FRANCHISEE = uuid.uuid4()


def _principal(role: str) -> Principal:
    return Principal(
        user=User(id=uuid.uuid4(), role=role),
        role=role,
        rank=ROLE_RANKS[role],
        is_superadmin=False,
        company_id=_COMPANY,
        vendor_id=uuid.uuid4() if role == VENDOR else None,
        franchisee_id=_FRANCHISEE if role in FRANCHISE_ROLES else None,
    )


@pytest.fixture
def call(monkeypatch: pytest.MonkeyPatch):
    state: dict = {}

    async def _db():
        yield object()

    async def _features(db, *, role, company_id):
        return list(state["features"])

    monkeypatch.setattr(deps, "effective_features", _features)
    app.dependency_overrides[get_current_principal] = lambda: state["principal"]
    app.dependency_overrides[get_db] = _db
    client = TestClient(app, raise_server_exceptions=False)

    def _call(method: str, path: str, role: str, features: list[str]):
        state["principal"] = _principal(role)
        state["features"] = features
        return client.request(method, PREFIX + path.format(id=_ID, id2=_ID), json={})

    yield _call
    app.dependency_overrides.pop(get_current_principal, None)
    app.dependency_overrides.pop(get_db, None)


def _passed(response) -> bool:
    return response.status_code not in (401, 403)


# name -> (method, path, feature, role that clears wall + floor, role that clears the
# wall but misses the floor - or None when no staff role sits below the floor)
STAFF = {
    "settings PUT /settings/travel (EditTravel)": (
        "PUT", "/settings/travel", "settings.edit", NATIONAL_HEAD, REGIONAL_HEAD),
    "franchisees GET (CanView)": (
        "GET", "/franchisees", "franchisees.view", AREA_MANAGER, None),
    "franchisees deactivate (CanManage)": (
        "POST", "/franchisees/{id}/deactivate", "franchisees.manage", NATIONAL_HEAD, REGIONAL_HEAD),
    "franchisees speed-rules PUT (CanEditSpeed)": (
        "PUT", "/franchisees/{id}/speed-rules", "settings.edit", NATIONAL_HEAD, REGIONAL_HEAD),
    "ledger statements (CanSeeStatements)": (
        "GET", "/ledger/statements/{id}", "earnings.view", NATIONAL_HEAD, REGIONAL_HEAD),
    "ledger entries (CanView)": (
        "GET", "/ledger", "earnings.view", ADMIN, None),
    "technicians PUT (CanEdit)": (
        "PUT", "/technicians/{id}", "technicians.edit", AREA_MANAGER, None),
    "technicians POST app-link (CanCreate)": (
        "POST", "/technicians/{id}/app-link", "technicians.create", AREA_MANAGER, None),
    "redemptions staff list (CanPay)": (
        "GET", "/redemptions", "redemptions.pay", NATIONAL_HEAD, REGIONAL_HEAD),
    "tickets reverse penalty (CanReversePenalty)": (
        "POST", "/tickets/{id}/penalties/{id2}/reverse", "penalties.reverse", AREA_MANAGER, None),
}

FRANCHISE = {
    "portal statements (CanSeeStatements)": (
        "GET", "/franchise/statements/{id}", "franchise.statements"),
    "franchise ledger pool (CanSee)": ("GET", "/franchise/ledger/pool", "franchise.pool"),
    "franchise redemptions (CanPay)": (
        "GET", "/franchise/redemptions/count", "franchise.payouts"),
    "franchise technicians (CanTech)": (
        "GET", "/franchise/technicians", "franchise.technicians"),
    "franchise settings (FranchiseSettings)": (
        "GET", "/franchise/settings/travel", "franchise.settings"),
}


@pytest.mark.parametrize("name", STAFF)
def test_staff_door_needs_the_feature_key(call, name: str) -> None:
    method, path, key, ok_role, _bad = STAFF[name]
    off = call(method, path, ok_role, [])
    assert off.status_code == 403, off.text
    assert "Missing feature" in off.text
    assert call(method, path, ok_role, ["unrelated.key"]).status_code == 403
    on = call(method, path, ok_role, [key])
    assert _passed(on), (on.status_code, on.text)


@pytest.mark.parametrize("name", [n for n, v in STAFF.items() if v[4]])
def test_staff_door_enforces_the_rank_floor_even_with_the_feature(call, name: str) -> None:
    method, path, key, _ok, bad_role = STAFF[name]
    response = call(method, path, bad_role, [key])
    assert response.status_code == 403, response.text
    assert "and above only" in response.text


@pytest.mark.parametrize("name", STAFF)
@pytest.mark.parametrize("role", [FRANCHISEE_ADMIN, FACILITY_ADMIN, VENDOR, TECHNICIAN])
def test_staff_door_refuses_every_other_family(call, name: str, role: str) -> None:
    method, path, key, _ok, _bad = STAFF[name]
    # Holding the key through a Feature Access override is exactly the case the
    # wall exists for.
    response = call(method, path, role, [key])
    assert response.status_code == 403, (role, response.text)


@pytest.mark.parametrize("name", FRANCHISE)
def test_franchise_twin_needs_its_franchise_key(call, name: str) -> None:
    method, path, key = FRANCHISE[name]
    off = call(method, path, FRANCHISEE_ADMIN, ["jobs.view"])
    assert off.status_code == 403, off.text
    assert "Missing feature" in off.text
    on = call(method, path, FRANCHISEE_ADMIN, [key])
    assert _passed(on), (on.status_code, on.text)


@pytest.mark.parametrize("name", FRANCHISE)
@pytest.mark.parametrize(
    "role", [ADMIN, NATIONAL_HEAD, AREA_MANAGER, FACILITY_ADMIN, VENDOR, TECHNICIAN]
)
def test_franchise_twin_refuses_everyone_but_the_franchisee_admin(
    call, name: str, role: str
) -> None:
    method, path, key = FRANCHISE[name]
    response = call(method, path, role, [key])
    assert response.status_code == 403, (role, response.text)
    assert "Only a franchisee admin" in response.text


def test_travel_put_now_carries_the_national_head_floor(call) -> None:
    """The regression this file exists for: `settings.edit` alone used to open it."""
    assert call("PUT", "/settings/travel", REGIONAL_HEAD, ["settings.edit"]).status_code == 403
    assert call("PUT", "/settings/travel", AREA_MANAGER, ["settings.edit"]).status_code == 403
    assert _passed(call("PUT", "/settings/travel", NATIONAL_HEAD, ["settings.edit"]))
    assert _passed(call("PUT", "/settings/travel", ADMIN, ["settings.edit"]))


def test_franchisees_manage_switched_off_stops_a_rank_qualified_admin(call) -> None:
    """The feature was never consulted there; now turning it off changes something."""
    path = "/franchisees/{id}/deactivate"
    off = call("POST", path, ADMIN, ["franchisees.view"])
    assert off.status_code == 403 and "franchisees.manage" in off.text
    assert _passed(call("POST", path, ADMIN, ["franchisees.manage"]))


def test_statements_check_both_the_feature_and_the_floor(call) -> None:
    path = "/ledger/statements/{id}"
    # floor met, feature off -> the check that used to be skipped
    assert call("GET", path, NATIONAL_HEAD, []).status_code == 403
    # feature on, floor missed -> the check that always ran
    assert call("GET", path, REGIONAL_HEAD, ["earnings.view"]).status_code == 403
    assert _passed(call("GET", path, NATIONAL_HEAD, ["earnings.view"]))


def test_a_wall_refusal_comes_before_the_feature_refusal(call) -> None:
    """A franchise login with no key is told about the door, not about the key."""
    response = call("GET", "/ledger/statements/{id}", FRANCHISEE_ADMIN, [])
    assert response.status_code == 403
    assert "Not available on this account" in response.text
