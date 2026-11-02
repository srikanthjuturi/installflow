"""Reading and writing a technician's own rules and holding (Epic 3).

Authority is the technician's own: `service._load_managed` is the wall. It 404s a
technician outside the caller's company or territory, and 403s one a staff user
can see but not manage (a non-home franchisee's) - so the franchisee admin edits
its technicians through the `/franchise` twin and the company's Admin / NH edit
the home franchisee's. A technician never edits their own.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import technician_rules as core
from app.core.deps import Principal
from app.core.rules import resolve_rules
from app.core.travel_rules import load_travel_rule
from app.features.technicians import service
from app.features.technicians.rules_schemas import (
    HoldingEventOut,
    HoldingIn,
    RulesInherited,
    TechnicianRulesIn,
    TechnicianRulesOut,
    TravelInherited,
)
from app.models.technician_rules import TechnicianHoldingEvent, TechnicianRules


def _label(principal: Principal) -> str:
    return ((principal.user.full_name or "").strip() or "—")[:120]


async def _out(db: AsyncSession, profile, row: TechnicianRules | None) -> TechnicianRulesOut:
    # The company-level answer, before any category overrides: a technician's
    # override replaces the TICKET's list, which varies per category, so the
    # company baseline is the honest placeholder.
    base = await resolve_rules(db, profile.company_id, None)
    travel = await load_travel_rule(
        db,
        company_id=profile.company_id,
        franchisee_id=profile.franchisee_id,
        technician_type=profile.technician_type,
    )
    history = (
        await db.scalars(
            select(TechnicianHoldingEvent)
            .where(
                TechnicianHoldingEvent.company_id == profile.company_id,
                TechnicianHoldingEvent.technician_id == profile.id,
            )
            .order_by(TechnicianHoldingEvent.at.desc())
            .limit(20)
        )
    ).all()
    r = row
    return TechnicianRulesOut(
        technicianId=profile.id,
        technicianType=profile.technician_type,
        payoutPercent=r.payout_percent if r else None,
        cancelPenaltiesPaise=r.cancel_penalties_paise if r else None,
        bonusBandsPaise=r.bonus_bands_paise if r else None,
        speedRewardWithinHours=r.speed_reward_within_hours if r else None,
        speedPenaltyAfterHours=r.speed_penalty_after_hours if r else None,
        speedRewardPaise=r.speed_reward_paise if r else None,
        speedPenaltyPaise=r.speed_penalty_paise if r else None,
        travelFreeKm=r.travel_free_km if r else None,
        travelPaisePerStep=r.travel_paise_per_step if r else None,
        travelMaxPaisePerJob=r.travel_max_paise_per_job if r else None,
        minRedeemablePaise=r.min_redeemable_paise if r else None,
        holdingPaise=int(r.holding_paise) if r else 0,
        inherited=RulesInherited(
            payoutPercent=100,
            cancelPenaltiesPaise=list(base["cancel_penalties_paise"]),
            bonusBandsPaise=list(base["bonus_bands_paise"]),
            travel=TravelInherited(
                freeKm=travel.free_km,
                paisePerStep=travel.paise_per_step,
                maxPaisePerJob=travel.max_paise_per_job,
            ),
        ),
        holdingHistory=[
            HoldingEventOut(
                id=h.id,
                oldPaise=h.old_paise,
                newPaise=h.new_paise,
                reason=h.reason,
                actorLabel=h.actor_label,
                at=h.at,
            )
            for h in history
        ],
        updatedAt=r.updated_at if r else None,
    )


async def get_rules(
    db: AsyncSession, principal: Principal, technician_id: uuid.UUID
) -> TechnicianRulesOut:
    # Reading follows the same wall as the profile itself.
    profile, _, _ = await service._load(db, principal, technician_id)
    return await _out(db, profile, await core.load(db, profile.company_id, profile.id))


async def put_rules(
    db: AsyncSession,
    principal: Principal,
    technician_id: uuid.UUID,
    body: TechnicianRulesIn,
) -> TechnicianRulesOut:
    profile, _, _ = await service._load_managed(db, principal, technician_id)
    row = await core.load(db, profile.company_id, profile.id)
    if row is None:
        row = TechnicianRules(company_id=profile.company_id, technician_id=profile.id)
        db.add(row)
    row.payout_percent = body.payoutPercent
    row.cancel_penalties_paise = body.cancelPenaltiesPaise
    row.bonus_bands_paise = body.bonusBandsPaise
    row.speed_reward_within_hours = body.speedRewardWithinHours
    row.speed_penalty_after_hours = body.speedPenaltyAfterHours
    row.speed_reward_paise = body.speedRewardPaise
    row.speed_penalty_paise = body.speedPenaltyPaise
    row.travel_free_km = body.travelFreeKm
    row.travel_paise_per_step = body.travelPaisePerStep
    row.travel_max_paise_per_job = body.travelMaxPaisePerJob
    row.min_redeemable_paise = body.minRedeemablePaise
    row.updated_by = principal.user_id
    if row.created_by is None:
        row.created_by = principal.user_id
    await db.commit()
    await db.refresh(row)
    return await _out(db, profile, row)


async def put_holding(
    db: AsyncSession,
    principal: Principal,
    technician_id: uuid.UUID,
    body: HoldingIn,
) -> TechnicianRulesOut:
    profile, _, _ = await service._load_managed(db, principal, technician_id)
    row = await core.load(db, profile.company_id, profile.id)
    if row is None:
        row = TechnicianRules(
            company_id=profile.company_id,
            technician_id=profile.id,
            holding_paise=0,
            created_by=principal.user_id,
        )
        db.add(row)
        await db.flush()
    old = int(row.holding_paise or 0)
    if old != body.amountPaise:
        row.holding_paise = body.amountPaise
        row.updated_by = principal.user_id
        db.add(
            TechnicianHoldingEvent(
                company_id=profile.company_id,
                technician_id=profile.id,
                old_paise=old,
                new_paise=body.amountPaise,
                reason=body.reason.strip(),
                actor_label=_label(principal),
                created_by=principal.user_id,
            )
        )
    await db.commit()
    await db.refresh(row)
    return await _out(db, profile, row)
