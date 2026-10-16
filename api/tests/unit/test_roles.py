"""Task 02 §6 cases 1–3 — the franchise role vocabulary and what rank says.

Pure: no database. `ensure_below_rank` is asserted around, NOT wired past — the
test documents the exact property the task relies on (§3.2): rank refuses a
franchisee admin's reach DOWN to a technician and admits a staff member's reach
down to a franchise role, which is why `create_user` refuses franchise roles BY
NAME and why technician authority is `core.franchise_scope`'s question.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.core.deps import Principal, ensure_below_rank
from app.core.scope import ALL_INDIA_ROLES
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    FRANCHISE_ROLES,
    FACILITY_ROLES,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    ROLE_LABELS,
    ROLE_RANKS,
    TECHNICIAN,
    VENDOR_ROLES,
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


def test_franchise_ranks_appended_below_everyone_and_unique() -> None:
    assert ROLE_RANKS[FRANCHISEE_ADMIN] == 8
    assert ROLE_RANKS[FACILITY_ADMIN] == 9
    assert ROLE_RANKS[FACILITY_OPERATOR] == 10
    ranks = list(ROLE_RANKS.values())
    assert len(ranks) == len(set(ranks))


def test_franchise_role_sets() -> None:
    assert FRANCHISE_ROLES == frozenset(
        {FRANCHISEE_ADMIN, FACILITY_ADMIN, FACILITY_OPERATOR}
    )
    assert FACILITY_ROLES == frozenset({FACILITY_ADMIN, FACILITY_OPERATOR})
    assert FACILITY_ROLES < FRANCHISE_ROLES
    assert not FRANCHISE_ROLES & VENDOR_ROLES
    assert not FRANCHISE_ROLES & ALL_INDIA_ROLES
    assert TECHNICIAN not in FRANCHISE_ROLES
    for role in FRANCHISE_ROLES:
        assert role in ROLE_LABELS


@pytest.mark.parametrize(
    ("actor", "target"),
    [
        (FRANCHISEE_ADMIN, TECHNICIAN),
        (FACILITY_ADMIN, TECHNICIAN),
        (FACILITY_OPERATOR, TECHNICIAN),
    ],
)
def test_ensure_below_rank_refuses_franchise_to_technician(
    actor: str, target: str
) -> None:
    with pytest.raises(HTTPException) as exc:
        ensure_below_rank(_principal(actor), target)
    assert exc.value.status_code == 403


def test_ensure_below_rank_admits_staff_to_franchise_role() -> None:
    # The documented reason `create_user` refuses franchise roles by name (§3.2):
    # rank says an Area Manager outranks one, which is exactly the hole.
    ensure_below_rank(_principal(AREA_MANAGER), FRANCHISEE_ADMIN)  # no raise


@pytest.mark.parametrize(
    ("actor", "target"),
    [
        (FRANCHISEE_ADMIN, FACILITY_ADMIN),
        (FRANCHISEE_ADMIN, FACILITY_OPERATOR),
        (FACILITY_ADMIN, FACILITY_OPERATOR),
        (ADMIN, FRANCHISEE_ADMIN),
        (NATIONAL_HEAD, FACILITY_ADMIN),
        (REGIONAL_HEAD, FACILITY_ADMIN),
    ],
)
def test_ensure_below_rank_inside_and_above_franchise_family(
    actor: str, target: str
) -> None:
    ensure_below_rank(_principal(actor), target)  # no raise


def test_ensure_below_rank_refuses_equal_rank() -> None:
    with pytest.raises(HTTPException) as exc:
        ensure_below_rank(_principal(FACILITY_ADMIN), FACILITY_ADMIN)
    assert exc.value.status_code == 403