"""Task 05 §6 cases 17–20 — `core.ledger.pool_arithmetic`, pure.

The pool from grouped totals: one franchisee's penalty/bonus circuit with a
reversal netted into "collected" and a `payout` ignored.
"""

from app.core.ledger import pool_arithmetic


# 17. Nothing → all zeros: an empty pool is a state, not a KeyError.
def test_case_17_empty_totals() -> None:
    assert pool_arithmetic({}) == {
        "balancePaise": 0,
        "penaltiesCollectedPaise": 0,
        "cancellations": 0,
        "bonusesPaidPaise": 0,
        "pickups": 0,
    }


# 18. Two penalties of ₹500 and one bonus of ₹400 → balance 100 (paise
#     ×100 here: 50000 − 40000), collected 50000, two charges, one pickup.
def test_case_18_penalties_and_bonus() -> None:
    assert pool_arithmetic(
        {"penalty": (50_000, 2), "bonus": (40_000, 1)}
    ) == {
        "balancePaise": 10_000,
        "penaltiesCollectedPaise": 50_000,
        "cancellations": 2,
        "bonusesPaidPaise": 40_000,
        "pickups": 1,
    }


# 19. A reversal netts back OUT of collected — ₹200 of ₹500 given back reads
#     as ₹300 collected against ONE charge still standing.
def test_case_19_reversal_nets_out() -> None:
    assert pool_arithmetic(
        {"penalty": (50_000, 2), "bonus": (40_000, 1), "reversal": (20_000, 1)}
    ) == {
        "balancePaise": -10_000,
        "penaltiesCollectedPaise": 30_000,
        "cancellations": 1,
        "bonusesPaidPaise": 40_000,
        "pickups": 1,
    }


# 20. A payout is not pool money (hard rule 2): present in the totals, absent
#     from the answer.
def test_case_20_payout_ignored() -> None:
    assert pool_arithmetic(
        {"penalty": (50_000, 2), "bonus": (40_000, 1), "reversal": (20_000, 1),
         "payout": (900_000_00, 3)}
    ) == pool_arithmetic(
        {"penalty": (50_000, 2), "bonus": (40_000, 1), "reversal": (20_000, 1)}
    )