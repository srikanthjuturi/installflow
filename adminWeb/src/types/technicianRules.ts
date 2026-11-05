/**
 * A technician's own rules and holding (Epic 3) — mirrors
 * `api/app/features/technicians/rules_schemas.py`. Every amount is PAISE.
 * `null` on any override means "inherit"; the PUT replaces the WHOLE set.
 */

export interface TechnicianRulesInput {
  payoutPercent: number | null;
  /** Exactly 4: "> 4h before slot", "2–4h", "< 2h", "No-show". */
  cancelPenaltiesPaise: number[] | null;
  /** Exactly 4, each above zero. */
  bonusBandsPaise: number[] | null;
  /** All four speed fields are set together, or none. */
  speedRewardWithinHours: number | null;
  speedPenaltyAfterHours: number | null;
  speedRewardPaise: number | null;
  speedPenaltyPaise: number | null;
  travelFreeKm: number | null;
  travelPaisePerStep: number | null;
  travelMaxPaisePerJob: number | null;
  minRedeemablePaise: number | null;
}

export interface HoldingEvent {
  id: string;
  oldPaise: number;
  newPaise: number;
  reason: string;
  actorLabel: string | null;
  at: string;
}

export interface InheritedRules {
  payoutPercent: number;
  cancelPenaltiesPaise: number[];
  bonusBandsPaise: number[];
  travel: { freeKm: number; paisePerStep: number; maxPaisePerJob: number };
}

export interface TechnicianRules extends TechnicianRulesInput {
  technicianId: string;
  technicianType: string;
  holdingPaise: number;
  inherited: InheritedRules;
  holdingHistory: HoldingEvent[];
  updatedAt: string | null;
}

export interface HoldingInput {
  /** 0 releases the hold. */
  amountPaise: number;
  reason: string;
}
