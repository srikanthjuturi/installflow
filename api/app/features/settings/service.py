"""Read and replace one company's operating rules.

The whole slice is two functions over one row. What earns it a module is the
conversion boundary: rupees on the wire, paise in storage (hard rule 9), done
here and nowhere else so no caller has to remember which side it is on.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.rules import CANCEL_PENALTY_BANDS, LIMITS, load_rules
from app.features.settings.schemas import (
    PenaltyBandOut,
    RulesOut,
    RulesUpdateRequest,
)
from app.models.company_rules import CompanyRules


def _to_rupees(paise: int) -> int:
    """Whole rupees. Every stored figure is a whole-rupee amount times 100 —
    `PUT` only accepts integers — so this never truncates anything real."""
    return paise // 100


def _out(rules: CompanyRules) -> RulesOut:
    ai_min, ai_max = LIMITS["ai_confidence_threshold"]
    return RulesOut(
        penalty=[
            PenaltyBandOut(band=band, amount=_to_rupees(paise))
            # zip, not an index: the label list is the authority on how many
            # bands there are, and the CHECK on the column already guarantees
            # the stored array matches its length.
            for band, paise in zip(CANCEL_PENALTY_BANDS, rules.cancel_penalties_paise)
        ],
        penaltyCap=_to_rupees(rules.cancel_penalty_cap_paise),
        bonusAmounts=[_to_rupees(p) for p in rules.bonus_bands_paise],
        aiThreshold=rules.ai_confidence_threshold,
        aiThresholdMin=ai_min,
        aiThresholdMax=ai_max,
        slaWarnAtPct=rules.sla_warn_at_pct,
        slotConfirmTimeoutHours=rules.slot_silence_hours,
        escalationTriggerHours=rules.escalate_hours_before_slot,
        customerWaitHours=rules.force_close_hours,
        renotifyGraceMinutes=rules.renotify_grace_minutes,
        slotReminderMinutes=rules.slot_reminder_minutes,
        customerNoticeMinutes=rules.customer_notice_minutes,
        geoRadiusM=rules.geo_radius_m,
    )


async def get_rules(db: AsyncSession, company_id: uuid.UUID) -> RulesOut:
    return _out(await load_rules(db, company_id))


async def update_rules(
    db: AsyncSession, principal: Principal, body: RulesUpdateRequest
) -> RulesOut:
    """Replace the whole row and answer with what is now stored.

    Answers from the row rather than echoing the request: the response is what
    the next reader will get, and a screen that re-seeds its form from an echo
    would not notice a value the database had adjusted or refused.
    """
    rules = await load_rules(db, principal.company_id)

    # A NEW list each time — SQLAlchemy does not track JSONB mutation in place,
    # so appending to or indexing into the existing list saves nothing.
    rules.cancel_penalties_paise = [amount * 100 for amount in body.penalty]
    rules.cancel_penalty_cap_paise = body.penaltyCap * 100
    rules.bonus_bands_paise = [amount * 100 for amount in body.bonusAmounts]

    rules.ai_confidence_threshold = body.aiThreshold
    rules.sla_warn_at_pct = body.slaWarnAtPct
    rules.slot_silence_hours = body.slotConfirmTimeoutHours
    rules.escalate_hours_before_slot = body.escalationTriggerHours
    rules.force_close_hours = body.customerWaitHours
    rules.renotify_grace_minutes = body.renotifyGraceMinutes
    rules.slot_reminder_minutes = body.slotReminderMinutes
    rules.customer_notice_minutes = body.customerNoticeMinutes
    rules.geo_radius_m = body.geoRadiusM
    rules.updated_by = principal.user_id

    # `get_db` yields a session and closes it; it does NOT commit. Every write
    # in this codebase commits for itself, and a flush alone would answer with
    # the new values and then roll them back on the way out — which is exactly
    # what the first end-to-end run of this endpoint did.
    await db.commit()
    return _out(rules)
