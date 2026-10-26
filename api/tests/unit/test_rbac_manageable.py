"""Task 02 §6 case 15 — Feature Access's two franchise refusals.

Pure: `_check_manageable_role` decides from the principal and the role string.
Feature Access edits a role's features company-wide, so the walls are: a
franchise principal never shapes anything, and only Admin/NH shape a franchise
role (F9 — `ensure_below_rank` cannot say it, RH ranks 3 and "outranks" 8).
"""

import uuid

import pytest
from fastapi import HTTPException

from app.core.deps import Principal
from app.features.rbac.service import _check_manageable_role
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_RANKS,
    SUPERADMIN,
    TECHNICIAN,
)
from app.models.user import User


def _principal(role: str) -> Principal:
    return Principal(
        user=User(id=uuid.uuid4(), role=role),
        role=role,
        rank=ROLE_RANKS[role],
        is_superadmin=False,
        company_id=uuid.uuid4(),
    )


@pytest.mark.parametrize(
    ("role", "target"),
    [
        (FRANCHISEE_ADMIN, TECHNICIAN),
        (FRANCHISEE_ADMIN, FACILITY_OPERATOR),
        (FRANCHISEE_ADMIN, SUPERADMIN),
        (FACILITY_ADMIN, FACILITY_OPERATOR),
        (FACILITY_ADMIN, ADMIN),
        (FACILITY_OPERATOR, FACILITY_OPERATOR),
    ],
)
def test_any_franchise_principal_is_refused(role: str, target: str) -> None:
    # The franchisee admin outranks the facility roles (8 < 9, 10), so rank
    # alone would let SkyFix's admin re-shape every franchisee's facility staff.
    with pytest.raises(HTTPException) as exc:
        _check_manageable_role(_principal(role), target)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Not available on this account"


def test_regional_head_cannot_shape_a_franchise_role() -> None:
    with pytest.raises(HTTPException) as exc:
        _check_manageable_role(_principal(REGIONAL_HEAD), "facility_operator")
    assert exc.value.status_code == 403
    assert exc.value.detail == "National Head and above only"


def test_national_head_shapes_a_franchise_role() -> None:
    _check_manageable_role(_principal(NATIONAL_HEAD), "facility_operator")  # no raise


def test_admin_still_shapes_staff_unchanged() -> None:
    _check_manageable_role(_principal(ADMIN), AREA_MANAGER)  # no raise