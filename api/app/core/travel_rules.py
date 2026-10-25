"""Where the travel allowance's per-franchisee rules are stored and edited.

Task 10. New core module rather than more symbols in `core/franchise.py`, so
Task 01's module keeps one subject. Shared by the franchise portal, the
settings slice and accept — slices never import each other (hard rule 4), and
`core.franchise` already carries the ownership question this one doesn't.

Exactly two rows per franchisee — `freelancer` and `employee` — stamped at
creation from `core.travel.TRAVEL_DEFAULTS` (TA4). The read path self-heals a
missing pair the way `core.rules.load_rules` does, so a franchisee created by
old code between the production migration and the publish still accepts jobs;
concurrent repairs collide on the unique constraint and the loser re-reads.

The arithmetic these rows feed lives in `core.travel` (`TravelRule`). A rule
change affects ONLY jobs accepted after it — `tickets.accept_snapshot` freezes
the answer at accept (TA5) and nothing downstream joins this table again.
"""

import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.travel import TRAVEL_DEFAULTS, TravelRule
from app.models.technician import TECHNICIAN_TYPES
from app.models.franchisee import FranchiseeTravelRule

_TECH_TYPES = tuple(TECHNICIAN_TYPES)
assert set(_TECH_TYPES) == set(TRAVEL_DEFAULTS), (
    "TRAVEL_DEFAULTS and TECHNICIAN_TYPES must name the same two types"
)


class TravelRuleIO(BaseModel):
    """One technician type's numbers, as the portals send and return them.

    The Field bounds are written as literals but MUST equal
    `core.travel.TRAVEL_LIMITS` — the model CHECKs, this pydantic model and the
    unit tests read one table; test 24 of §6 asserts the equality by
    introspection.
    """

    model_config = ConfigDict(from_attributes=True)

    # pydantic v2 field bounds (literals, mirrored in TRAVEL_LIMITS):
    #   free_km 0-500, step_km 1-50, paise_per_step 0-1_000_000,
    #   road_factor_pct 100-300, max_paise_per_job 0-10_000_000
    freeKm: int = Field(ge=0, le=500)
    stepKm: int = Field(ge=1, le=50)
    paisePerStep: int = Field(ge=0, le=1_000_000)
    roadFactorPct: int = Field(ge=100, le=300)
    maxPaisePerJob: int = Field(ge=0, le=10_000_000)

    @model_validator(mode="after")
    def _a_rate_needs_a_cap(self):          # W2
        if self.paisePerStep > 0 and self.maxPaisePerJob == 0:
            raise ValueError(
                "Set a maximum per job — with a ₹0 maximum the allowance is always ₹0."
            )
        return self

    def as_rule(self) -> TravelRule:
        return TravelRule(
            free_km=self.freeKm,
            step_km=self.stepKm,
            paise_per_step=self.paisePerStep,
            road_factor_pct=self.roadFactorPct,
            max_paise_per_job=self.maxPaisePerJob,
        )


class TravelRulesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    freelancer: TravelRuleIO
    employee: TravelRuleIO


class TravelRulesIn(TravelRulesOut):
    """The PUT body — the same shape, both types required."""


async def stamp_travel_rules(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    by_user: uuid.UUID | None = None,
) -> None:
    """Insert the two `TRAVEL_DEFAULTS` rows, `ON CONFLICT … DO NOTHING`.

    Flushes, does NOT commit — the `core.rules.load_rules` contract: the caller
    owns the transaction (`create_company` and the franchisee create both call
    this in the middle of building something bigger).
    """
    stmt = (
        insert(FranchiseeTravelRule)
        .values([
            {
                "company_id": company_id,
                "franchisee_id": franchisee_id,
                "technician_type": ttype,
                "free_km": rule.free_km,
                "step_km": rule.step_km,
                "paise_per_step": rule.paise_per_step,
                "road_factor_pct": rule.road_factor_pct,
                "max_paise_per_job": rule.max_paise_per_job,
                "created_by": by_user,
                "updated_by": by_user,
            }
            for ttype, rule in TRAVEL_DEFAULTS.items()
        ])
        .on_conflict_do_nothing(
            constraint="uq_franchisee_travel_rules_company_franchisee_type"
        )
    )
    await db.execute(stmt)
    await db.flush()  # hard rule 10 — readers in the same request need the rows


async def load_travel_rule(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    technician_type: str,
) -> TravelRule:
    """One type's rule, self-healing a missing pair by stamping both.

    `core.rules.load_rules`'s shape: a franchisee created by old code between
    the production migration and the publish (or a row hand-deleted) must not
    make the next accept 500. The same stamp and re-read repairs the missing
    row on the next read; `stamp_travel_rules`' ON CONFLICT makes a concurrent
    self-heal harmless rather than a duplicate.
    """
    row = await _rule_row(db, company_id=company_id, franchisee_id=franchisee_id,
                          technician_type=technician_type)
    if row is None:
        await stamp_travel_rules(db, company_id=company_id, franchisee_id=franchisee_id)
        row = await _rule_row(db, company_id=company_id, franchisee_id=franchisee_id,
                              technician_type=technician_type)
    return _to_rule(row)


def _to_rule(row: FranchiseeTravelRule) -> TravelRule:
    return TravelRule(
        free_km=row.free_km,
        step_km=row.step_km,
        paise_per_step=row.paise_per_step,
        road_factor_pct=row.road_factor_pct,
        max_paise_per_job=row.max_paise_per_job,
    )


async def _rule_row(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    technician_type: str,
) -> FranchiseeTravelRule | None:
    return await db.scalar(
        select(FranchiseeTravelRule).where(
            FranchiseeTravelRule.company_id == company_id,
            FranchiseeTravelRule.franchisee_id == franchisee_id,
            FranchiseeTravelRule.technician_type == technician_type,
        )
    )


async def _load_both(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> dict[str, FranchiseeTravelRule]:
    rows = {
        r.technician_type: r
        for r in (
            await db.scalars(
                select(FranchiseeTravelRule).where(
                    FranchiseeTravelRule.company_id == company_id,
                    FranchiseeTravelRule.franchisee_id == franchisee_id,
                )
            )
        )
    }
    if set(rows) != set(_TECH_TYPES):
        # Missing a pair mid-read — the same old-code hole the self-heal fixes,
        # one stamp for both types, then trust the read again.
        await stamp_travel_rules(db, company_id=company_id, franchisee_id=franchisee_id)
        rows = {
            r.technician_type: r
            for r in (
                await db.scalars(
                    select(FranchiseeTravelRule).where(
                        FranchiseeTravelRule.company_id == company_id,
                        FranchiseeTravelRule.franchisee_id == franchisee_id,
                    )
                )
            )
        }
    return rows


def _to_io(row: FranchiseeTravelRule) -> TravelRuleIO:
    # The wire fields are camelCase and the columns snake_case, so
    # `model_validate(row)` finds nothing — name each one.
    return TravelRuleIO(
        freeKm=row.free_km,
        stepKm=row.step_km,
        paisePerStep=row.paise_per_step,
        roadFactorPct=row.road_factor_pct,
        maxPaisePerJob=row.max_paise_per_job,
    )


async def get_travel_rules(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> TravelRulesOut:
    """Both types, for the GET endpoints. Self-heals a missing pair."""
    rows = await _load_both(db, company_id=company_id, franchisee_id=franchisee_id)
    return TravelRulesOut(
        freelancer=_to_io(rows["freelancer"]),
        employee=_to_io(rows["employee"]),
    )


async def put_travel_rules(
    db: AsyncSession, *, company_id: uuid.UUID, franchisee_id: uuid.UUID,
    body: TravelRulesIn, by_user: uuid.UUID,
) -> TravelRulesOut:
    """Write both rows in one transaction; W2 was validated by `TravelRuleIO`.

    A rule change affects only jobs accepted after it (TA5): nothing here
    touches a snapshot already stamped, and every reader of these rows is
    `accept` (and the portals this module serves).
    """
    rows = await _load_both(db, company_id=company_id, franchisee_id=franchisee_id)
    for ttype in _TECH_TYPES:
        rule = getattr(body, ttype).as_rule()
        row = rows.get(ttype)
        if row is None:
            # _load_both stamps DEFAULTS to repair a read — an edit in
            # progress would then return on those. Write the row fresh from
            # the body instead.
            row = FranchiseeTravelRule(
                company_id=company_id,
                franchisee_id=franchisee_id,
                technician_type=ttype,
                created_by=by_user,
            )
            db.add(row)
        row.free_km = rule.free_km
        row.step_km = rule.step_km
        row.paise_per_step = rule.paise_per_step
        row.road_factor_pct = rule.road_factor_pct
        row.max_paise_per_job = rule.max_paise_per_job
        row.updated_by = by_user
    await db.flush()
    return await get_travel_rules(db, company_id=company_id, franchisee_id=franchisee_id)


__all__ = [
    "TravelRuleIO",
    "TravelRulesIn",
    "TravelRulesOut",
    "get_travel_rules",
    "load_travel_rule",
    "put_travel_rules",
    "stamp_travel_rules",
]