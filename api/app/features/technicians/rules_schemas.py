"""A technician's own rules and holding, on the wire (Epic 3)."""

import datetime
import uuid

from pydantic import Field, model_validator

from app.core.rules import BONUS_BAND_COUNT, CANCEL_PENALTY_COUNT
from app.core.schemas import AppModel
from app.models.technician_rules import (
    BONUS_PAISE,
    PAYOUT_PERCENT,
    PENALTY_PAISE,
    REDEEM_PAISE,
    SPEED_HOURS,
    SPEED_PAISE,
    TRAVEL_FREE_KM,
    TRAVEL_MAX_PAISE,
    TRAVEL_RATE_PAISE,
)


class TechnicianRulesIn(AppModel):
    """The whole override set. PUT replaces it: a field left out or null INHERITS.

    Amounts are PAISE. Speed is all four or none.
    """

    payoutPercent: int | None = Field(default=None, ge=PAYOUT_PERCENT[0], le=PAYOUT_PERCENT[1])
    cancelPenaltiesPaise: list[int] | None = None
    bonusBandsPaise: list[int] | None = None

    speedRewardWithinHours: int | None = Field(default=None, ge=SPEED_HOURS[0], le=SPEED_HOURS[1])
    speedPenaltyAfterHours: int | None = Field(default=None, ge=SPEED_HOURS[0], le=SPEED_HOURS[1])
    speedRewardPaise: int | None = Field(default=None, ge=SPEED_PAISE[0], le=SPEED_PAISE[1])
    speedPenaltyPaise: int | None = Field(default=None, ge=SPEED_PAISE[0], le=SPEED_PAISE[1])

    travelFreeKm: int | None = Field(default=None, ge=TRAVEL_FREE_KM[0], le=TRAVEL_FREE_KM[1])
    travelPaisePerStep: int | None = Field(
        default=None, ge=TRAVEL_RATE_PAISE[0], le=TRAVEL_RATE_PAISE[1]
    )
    travelMaxPaisePerJob: int | None = Field(
        default=None, ge=TRAVEL_MAX_PAISE[0], le=TRAVEL_MAX_PAISE[1]
    )

    minRedeemablePaise: int | None = Field(default=None, ge=0, le=REDEEM_PAISE[1])

    @model_validator(mode="after")
    def _consistent(self):
        if self.cancelPenaltiesPaise is not None:
            self._band(self.cancelPenaltiesPaise, CANCEL_PENALTY_COUNT, PENALTY_PAISE, "penalty")
        if self.bonusBandsPaise is not None:
            self._band(self.bonusBandsPaise, BONUS_BAND_COUNT, BONUS_PAISE, "bonus")
        speed = [
            self.speedRewardWithinHours,
            self.speedPenaltyAfterHours,
            self.speedRewardPaise,
            self.speedPenaltyPaise,
        ]
        if any(v is not None for v in speed) and any(v is None for v in speed):
            raise ValueError(
                "Speed terms are set together: both hour limits and both amounts, or none"
            )
        if (
            self.speedRewardWithinHours is not None
            and self.speedPenaltyAfterHours < self.speedRewardWithinHours
        ):
            raise ValueError("The slow limit cannot be sooner than the fast limit")
        return self

    @staticmethod
    def _band(values: list[int], count: int, bounds: tuple[int, int], what: str) -> None:
        if len(values) != count:
            raise ValueError(f"Give exactly {count} {what} amounts")
        for v in values:
            if isinstance(v, bool) or not (bounds[0] <= v <= bounds[1]):
                raise ValueError(f"Each {what} amount must be {bounds[0]} to {bounds[1]} paise")


class TravelInherited(AppModel):
    freeKm: int
    paisePerStep: int
    maxPaisePerJob: int


class RulesInherited(AppModel):
    """What applies when a field is not overridden, for the panel's placeholders."""

    payoutPercent: int
    cancelPenaltiesPaise: list[int]
    bonusBandsPaise: list[int]
    travel: TravelInherited


class HoldingEventOut(AppModel):
    id: uuid.UUID
    oldPaise: int
    newPaise: int
    reason: str
    actorLabel: str | None
    at: datetime.datetime


class TechnicianRulesOut(TechnicianRulesIn):
    technicianId: uuid.UUID
    technicianType: str
    holdingPaise: int
    inherited: RulesInherited
    holdingHistory: list[HoldingEventOut]
    updatedAt: datetime.datetime | None


class HoldingIn(AppModel):
    """Set the held amount. 0 releases it. A reason is always required."""

    amountPaise: int = Field(ge=0, le=REDEEM_PAISE[1])
    reason: str = Field(min_length=3, max_length=240)
