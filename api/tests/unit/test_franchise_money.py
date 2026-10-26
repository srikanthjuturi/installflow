"""Task 05 §6 cases 12–16 — the money rule and its pure helpers.

`may_see_money` / `may_reverse` are the REVERSE column of Task 02's matrix,
worded as money (cases 12–13); `pool_franchisee` resolves WHICH pool a read is
about (case 14); `redemption_audience` picks whose bell a redemption rings
(case 15); `type_change_refusal` is owner ruling R5 (case 16). All pure.
"""

import uuid

import pytest

from app.core.franchise_money import (
    may_reverse,
    may_see_money,
    pool_franchisee,
    redemption_audience,
    type_change_refusal,
)
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    TECHNICIAN,
    VENDOR,
)

_HOME = uuid.uuid4()
_S = uuid.uuid4()  # an external franchisee's money
_G = uuid.uuid4()  # another one


# 12. may_see_money — admin/NH any; RH/AM home only; franchisee admin own;
#     everyone else nothing. One cell per row of franchise_money's table.
@pytest.mark.parametrize(
    ("role", "principal_fid", "money_fid", "expected"),
    [
        (ADMIN, None, _HOME, True),
        (ADMIN, None, _S, True),
        (NATIONAL_HEAD, None, _S, True),
        (REGIONAL_HEAD, None, _HOME, True),
        (REGIONAL_HEAD, None, _S, False),
        (AREA_MANAGER, None, _HOME, True),
        (AREA_MANAGER, None, _S, False),
        (FRANCHISEE_ADMIN, _S, _S, True),
        (FRANCHISEE_ADMIN, _S, _HOME, False),
        (FACILITY_ADMIN, _S, _S, False),
        (TECHNICIAN, None, _HOME, False),
        (VENDOR, None, _HOME, False),
    ],
)
def test_case_12_may_see_money(role: str, principal_fid, money_fid, expected) -> None:
    assert (
        may_see_money(
            role=role,
            principal_franchisee_id=principal_fid,
            money_franchisee_id=money_fid,
            home_id=_HOME,
        )
        == expected
    )


# 13. may_reverse — the same matrix, on the penalty's own franchisee, plus
#     F8's second sentence: HOME's own franchisee admin is exactly where its
#     staff sit, so it may reverse home's money and nobody else's.
@pytest.mark.parametrize(
    ("role", "principal_fid", "penalty_fid", "expected"),
    [
        (ADMIN, None, _S, True),
        (NATIONAL_HEAD, None, _HOME, True),
        (REGIONAL_HEAD, None, _S, False),
        (AREA_MANAGER, None, _HOME, True),
        (FRANCHISEE_ADMIN, _S, _S, True),
        (FRANCHISEE_ADMIN, _S, _HOME, False),
        (FACILITY_ADMIN, _S, _S, False),
    ],
)
def test_case_13_may_reverse(role: str, principal_fid, penalty_fid, expected) -> None:
    assert (
        may_reverse(
            role=role,
            principal_franchisee_id=principal_fid,
            penalty_franchisee_id=penalty_fid,
            home_id=_HOME,
        )
        == expected
    )


def test_case_13_home_admin_is_home_alone() -> None:
    assert may_reverse(
        role=FRANCHISEE_ADMIN,
        principal_franchisee_id=_HOME,
        penalty_franchisee_id=_HOME,
        home_id=_HOME,
    )
    assert not may_reverse(
        role=FRANCHISEE_ADMIN,
        principal_franchisee_id=_HOME,
        penalty_franchisee_id=_S,
        home_id=_HOME,
    )


# 14. Which pool a read is about: franchise → OWN, a foreign `requested`
#     ignored; own None → None (a corrupt principal reads nothing); staff
#     absent → home; staff named `requested` in `known` → it; unknown → None.
def test_case_14_pool_franchisee() -> None:
    known = {_HOME, _S, _G}
    assert pool_franchisee(
        is_franchise=True, own=_S, requested=_G, home_id=_HOME, known=known
    ) == _S
    assert pool_franchisee(is_franchise=True, own=None, requested=_G, home_id=_HOME,
                           known=known) is None
    assert pool_franchisee(
        is_franchise=False, own=None, requested=None, home_id=_HOME, known=known
    ) == _HOME
    assert pool_franchisee(
        is_franchise=False, own=None, requested=_S, home_id=_HOME, known=known
    ) == _S
    assert pool_franchisee(
        is_franchise=False, own=None, requested=uuid.uuid4(), home_id=_HOME,
        known=known,
    ) is None


# 15. Whose bell a redemption rings.
def test_case_15_redemption_audience() -> None:
    assert redemption_audience(is_home=True) == "payers"
    assert redemption_audience(is_home=False) == "franchisee_admin"


# 16. R5: the type change is refused while open jobs exist, only then.
#     (Task 06 extended the signature with `freelancer_balance_paise`; its
#     own balance-clause cases live in test_employment. These keep covering
#     the open-jobs clause — including with plenty of balance, which the
#     employee→freelancer direction must not consult.)
def test_case_16_type_change_refusal() -> None:
    assert (
        type_change_refusal(
            old="employee", new="employee", open_jobs=2, freelancer_balance_paise=0
        )
        is None
    )
    assert (
        type_change_refusal(
            old="employee", new="freelancer", open_jobs=0, freelancer_balance_paise=0
        )
        is None
    )
    refusal = type_change_refusal(
        old="employee", new="freelancer", open_jobs=2, freelancer_balance_paise=0
    )
    assert refusal is not None
    code, message = refusal
    assert code == "TECHNICIAN_HAS_OPEN_JOBS"
    assert "2" in message