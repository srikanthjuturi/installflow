"""Task 05 §6 cases 17–20 — `core.ledger.pool_arithmetic`, pure.

The pool from grouped totals: one franchisee's penalty/bonus circuit with a
reversal netted into "collected" and a `payout` ignored. Task 11 (W11) added
the four `speed*` breakdown fields — additive into the two tiles the cases
below already assert — and §4.6 made a `speed_penalty` reversible like a
penalty, netted by the TARGET kind (cases 21–22 here).
"""

from app.core.ledger import pool_arithmetic

#: The four additive fields Task 11 added to every answer, for the assertions
#: that don't care about the split.
_BASE = {
    "speedPenaltyPaise": 0,
    "speedPenalties": 0,
    "speedRewardPaise": 0,
    "speedRewards": 0,
}


# 17. Nothing → all zeros: an empty pool is a state, not a KeyError.
def test_case_17_empty_totals() -> None:
    assert pool_arithmetic({}) == {
        "balancePaise": 0,
        "penaltiesCollectedPaise": 0,
        "cancellations": 0,
        "bonusesPaidPaise": 0,
        "pickups": 0,
        **_BASE,
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
        **_BASE,
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
        **_BASE,
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


# 21. (Task 11 §4.7) A reversal tagged with its TARGET kind nets out of the
#     right column: a speed penalty given back leaves `cancellations` alone
#     and drops out of `speedPenalty*` instead.
def test_case_21_speed_reversal_nets_out_of_the_speed_figures() -> None:
    assert pool_arithmetic(
        {
            ("speed_penalty", None): (30_000, 2),
            ("reversal", "speed_penalty"): (30_000, 2),
            "penalty": (50_000, 2),
        }
    ) == {
        "balancePaise": 50_000,
        "penaltiesCollectedPaise": 50_000,   # every speed penalty was given back
        "cancellations": 2,
        "bonusesPaidPaise": 0,
        "pickups": 0,
        "speedPenaltyPaise": 0,
        "speedPenalties": 0,
        "speedRewardPaise": 0,
        "speedRewards": 0,
    }


# 22. (Task 11 §4.7, W7) A speed reward is pool money out, beside a bonus —
#     the balance holds across all four kinds at once.
def test_case_22_speed_reward_folds_into_the_balance() -> None:
    assert pool_arithmetic(
        {
            ("penalty", None): (50_000, 1),
            ("speed_penalty", None): (15_000, 1),
            ("bonus", None): (40_000, 1),
            ("speed_reward", None): (20_000, 1),
        }
    ) == {
        "balancePaise": 5_000,
        "penaltiesCollectedPaise": 65_000,
        "cancellations": 1,
        "bonusesPaidPaise": 60_000,
        "pickups": 1,
        "speedPenaltyPaise": 15_000,
        "speedPenalties": 1,
        "speedRewardPaise": 20_000,
        "speedRewards": 1,
    }