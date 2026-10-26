"""Task 06 §6 cases 1–4 — the employment predicates and their refusal.

`pays_per_job` / `may_redeem` are T2/T4 worded as questions; `redeem_refusal`
is the sentence the redeem flow answers a 409 with; the `type_change_refusal`
cases are R5's balance clause, seated AFTER Task 05's open-jobs clause. All
pure.
"""

import pytest

from app.core.employment import may_redeem, pays_per_job, redeem_refusal
from app.core.franchise_money import type_change_refusal

#: The sentence Task 07 proposes to draw under the code — one fact, copied
#: once in `employment` and asserted here so a reword shows up in review.
_SALARY_SENTENCE = (
    "Employees are paid through salary, so there is nothing to redeem."
)


# 1. T2: who is paid per job. Employees are not — and None/unknown are, on
#    purpose: an unreadable type must not silently stop paying somebody.
@pytest.mark.parametrize(
    ("technician_type", "expected"),
    [
        ("employee", False),
        ("freelancer", True),
        (None, True),
        ("contractor", True),
    ],
)
def test_case_1_pays_per_job(technician_type: str, expected: bool) -> None:
    assert pays_per_job(technician_type) == expected


# 2. T4: who may ask to be paid by UPI. Only an employee is refused.
@pytest.mark.parametrize(
    ("technician_type", "expected"),
    [
        ("employee", False),
        ("freelancer", True),
        (None, True),
    ],
)
def test_case_2_may_redeem(technician_type: str, expected: bool) -> None:
    assert may_redeem(technician_type) == expected


# 3. The refusal: (code, the exact sentence) for an employee, None otherwise.
def test_case_3_redeem_refusal() -> None:
    assert redeem_refusal("employee") == ("EMPLOYEE_CANNOT_REDEEM", _SALARY_SENTENCE)
    assert redeem_refusal("freelancer") is None
    assert redeem_refusal(None) is None


# 4. R5, extended with the balance — open jobs FIRST, then the money.
#    freelancer→employee with anything to redeem is refused; nothing or a debt
#    is not; the reverse direction never consults the balance; and same type
#    is nobody's business. (Task 05's own cases live in test_franchise_money.)
def test_case_4_type_change_refusal() -> None:
    # balance 1 paisa is still balance.
    refusal = type_change_refusal(
        old="freelancer", new="employee", open_jobs=0, freelancer_balance_paise=1
    )
    assert refusal is not None
    code, message = refusal
    assert code == "TECHNICIAN_HAS_BALANCE"
    assert "waiting to be redeemed" in message

    # Nothing to take out, or a debt — switch goes ahead.
    assert type_change_refusal(
        old="freelancer", new="employee", open_jobs=0, freelancer_balance_paise=0
    ) is None
    assert type_change_refusal(
        old="freelancer", new="employee", open_jobs=0, freelancer_balance_paise=-5000
    ) is None

    # Employee→freelancer: open jobs only, the balance clause cannot fire.
    assert type_change_refusal(
        old="employee", new="freelancer", open_jobs=0, freelancer_balance_paise=9999
    ) is None

    # Open jobs win over the balance — both cannot be said at once, and the
    # first clause is the owner's chosen order.
    refusal = type_change_refusal(
        old="freelancer", new="employee", open_jobs=1, freelancer_balance_paise=100
    )
    assert refusal is not None
    assert refusal[0] == "TECHNICIAN_HAS_OPEN_JOBS"

    # Same type: nothing to say either way.
    assert type_change_refusal(
        old="freelancer", new="freelancer", open_jobs=3, freelancer_balance_paise=100
    ) is None

    with pytest.raises(TypeError):
        # The keyword is required — a caller that forgets to ask the balance
        # must not get a free pass by accident.
        _ = type_change_refusal(old="freelancer", new="employee", open_jobs=0)