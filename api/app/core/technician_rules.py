"""Per-technician overrides: read, freeze at accept, and apply (Epic 3).

Read `models/technician_rules.py` first. The shape of the idea:

  * a row (or no row) of nullable overrides per technician -- NULL inherits;
  * at ACCEPT, `build_overrides` copies the ones that touch a job into
    `tickets.accept_snapshot["overrides"]` (payout, penalties, bonus chips) and
    `apply_to_travel` / `speed_terms` fold the other two into the travel and speed
    terms the snapshot already carries -- so editing a technician's rules later
    restates nothing already accepted;
  * every reader goes through the accessors below, which never raise on a
    missing, partial or ill-typed snapshot (a job accepted before this existed
    has no `overrides` key and simply pays the ticket's own figures);
  * the two REDEMPTION terms are live (`redemption_terms`), not frozen.
"""

import dataclasses
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rules import BONUS_BAND_COUNT, CANCEL_PENALTY_COUNT, snapshot_value
from app.core.speed import SpeedTerms
from app.core.travel import TravelRule
from app.models.technician_rules import (
    BONUS_PAISE,
    PAYOUT_PERCENT,
    PENALTY_PAISE,
    TechnicianRules,
)

# ── loading ──────────────────────────────────────────────────────────────────


async def load(
    db: AsyncSession, company_id: uuid.UUID, technician_id: uuid.UUID
) -> TechnicianRules | None:
    return await db.scalar(
        select(TechnicianRules).where(
            TechnicianRules.company_id == company_id,
            TechnicianRules.technician_id == technician_id,
        )
    )


# ── freezing at accept ───────────────────────────────────────────────────────


def build_overrides(row: TechnicianRules | None) -> dict | None:
    """The job-touching overrides to freeze into the accept snapshot, or None.

    Only keys that are SET appear, so "no override" and "no row" are the same
    snapshot. Speed and travel are not here: they are folded into their own keys.
    """
    if row is None:
        return None
    out: dict = {}
    if row.payout_percent is not None:
        out["payoutPercent"] = int(row.payout_percent)
    if row.cancel_penalties_paise is not None:
        out["cancelPenaltiesPaise"] = [int(v) for v in row.cancel_penalties_paise]
    if row.bonus_bands_paise is not None:
        out["bonusBandsPaise"] = [int(v) for v in row.bonus_bands_paise]
    return out or None


def apply_to_travel(rule: TravelRule, row: TechnicianRules | None) -> TravelRule:
    """The franchisee's travel rule with this technician's set fields laid over it."""
    if row is None:
        return rule
    changes = {}
    if row.travel_free_km is not None:
        changes["free_km"] = int(row.travel_free_km)
    if row.travel_paise_per_step is not None:
        changes["paise_per_step"] = int(row.travel_paise_per_step)
    if row.travel_max_paise_per_job is not None:
        changes["max_paise_per_job"] = int(row.travel_max_paise_per_job)
    return dataclasses.replace(rule, **changes) if changes else rule


def speed_terms(row: TechnicianRules | None) -> SpeedTerms | None:
    """This technician's own speed terms, or None to use the franchisee's matrix.

    All four are set together (a CHECK), and they replace the matrix match for
    EVERY product -- a technician-level agreement beats the category rows.
    """
    if row is None or row.speed_reward_within_hours is None:
        return None
    return SpeedTerms(
        rule_id=None,
        matched_on="technician",
        matched_id=row.technician_id,
        reward_within_hours=int(row.speed_reward_within_hours),
        penalty_after_hours=int(row.speed_penalty_after_hours),
        reward_paise=int(row.speed_reward_paise),
        penalty_paise=int(row.speed_penalty_paise),
    )


# ── reading the frozen snapshot ──────────────────────────────────────────────


def _overrides(snapshot: dict | None) -> dict:
    over = snapshot.get("overrides") if isinstance(snapshot, dict) else None
    return over if isinstance(over, dict) else {}


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def payout_percent_of(snapshot: dict | None) -> int | None:
    v = _overrides(snapshot).get("payoutPercent")
    if _is_int(v) and PAYOUT_PERCENT[0] <= v <= PAYOUT_PERCENT[1]:
        return v
    return None


def _band_list(snapshot: dict | None, key: str, count: int, low: int, high: int):
    v = _overrides(snapshot).get(key)
    if (
        isinstance(v, list)
        and len(v) == count
        and all(_is_int(x) and low <= x <= high for x in v)
    ):
        return list(v)
    return None


def cancel_penalties_of(snapshot: dict | None) -> list[int] | None:
    return _band_list(
        snapshot, "cancelPenaltiesPaise", CANCEL_PENALTY_COUNT, *PENALTY_PAISE
    )


def bonus_bands_of(snapshot: dict | None) -> list[int] | None:
    return _band_list(snapshot, "bonusBandsPaise", BONUS_BAND_COUNT, *BONUS_PAISE)


# ── applying ─────────────────────────────────────────────────────────────────


def paid_amount(stamped_paise: int, percent: int | None) -> int:
    """The per-job payout after the technician's percentage, rounded half up.

    Never below ₹0.01 for a positive stamp: a percentage must not silently
    erase a job's pay.
    """
    if percent is None or percent == 100:
        return stamped_paise
    scaled = (stamped_paise * percent + 50) // 100
    return max(scaled, 1) if stamped_paise > 0 else 0


def penalty_bands_for(ticket) -> list[int]:
    """The cancellation bands that apply to THIS job: the holder's frozen
    override if there is one, else the ticket's own stamped bands."""
    return cancel_penalties_of(getattr(ticket, "accept_snapshot", None)) or list(
        snapshot_value(ticket.rules_snapshot, "cancel_penalties_paise")
    )


def bonus_bands_for(ticket) -> list[int]:
    return bonus_bands_of(getattr(ticket, "accept_snapshot", None)) or list(
        snapshot_value(ticket.rules_snapshot, "bonus_bands_paise")
    )


# ── redemption terms (live) ──────────────────────────────────────────────────


@dataclasses.dataclass(frozen=True)
class RedemptionTerms:
    min_paise: int
    holding_paise: int


async def redemption_terms(
    db: AsyncSession, company_id: uuid.UUID, technician_id: uuid.UUID
) -> RedemptionTerms:
    row = await load(db, company_id, technician_id)
    if row is None:
        return RedemptionTerms(0, 0)
    return RedemptionTerms(int(row.min_redeemable_paise or 0), int(row.holding_paise or 0))


def redeemable_after_holding(available_paise: int, holding_paise: int) -> int:
    """What may be asked for: the balance less what is held, never below 0."""
    return max(available_paise - holding_paise, 0)
