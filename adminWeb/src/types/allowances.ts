/**
 * Travel and speed allowances, the base location, and the two ticket blocks
 * that report them — Task 13 §5.3, copied from Tasks 10/11 §4 as built
 * (`api/app/core/travel_rules.py`, `speed_rules.py`, `base_location.py`,
 * `features/tickets/schemas.py`).
 *
 * **PAISE on the wire**, unlike `/settings/rules`, which carries rupees: the
 * forms show rupees and convert at the edge (`travelSchema.toTravelBody`).
 */

import type { TechnicianType } from "./technician";

/* ── travel rules ───────────────────────────────────────────────────────── */

/** One technician type's numbers — `TravelRuleIO`. */
export interface TravelRule {
  /** 0–500. Nothing is paid up to this distance. */
  freeKm: number;
  /** 1–50. Part of a step is not paid. */
  stepKm: number;
  /** 0–1 000 000 paise. 0 = the allowance is off. */
  paisePerStep: number;
  /** 100–300. Straight line × this = road distance. */
  roadFactorPct: number;
  /** 0–10 000 000 paise. A rate above 0 needs a maximum above 0 (W2). */
  maxPaisePerJob: number;
}

/** `TravelRulesOut` — and the PUT body. Both types, always. */
export interface TravelRules {
  freelancer: TravelRule;
  employee: TravelRule;
}

/* ── speed rules ────────────────────────────────────────────────────────── */

/** `SpeedRuleOut` — one row of the franchisee's matrix. */
export interface SpeedRule {
  id: string;
  technicianType: TechnicianType;
  targetKind: "node" | "model";
  targetId: string;
  /** Node or model name; "—" when the target is gone. */
  targetName: string;
  /**
   * Root-first names, ENDING with the target's own name (a model's is its
   * node's path plus the model). `speedRows.targetLabel` joins it with " › ".
   */
  targetPath: string[];
  /** False when the target is gone or switched off. */
  targetActive: boolean;
  rewardWithinHours: number;
  penaltyAfterHours: number;
  rewardPaise: number;
  penaltyPaise: number;
  /** The nearest shallower row of the same type this one beats. */
  overridesRuleId: string | null;
  overridesName: string | null;
  /** Rows of the same type beneath this node. */
  overriddenBy: number;
  updatedAt: string;
}

/** `SpeedRuleIn` — the PUT body, an upsert on type + target. */
export interface SpeedRuleInput {
  technicianType: TechnicianType;
  /** Exactly one of the two. */
  nodeId: string | null;
  modelId: string | null;
  /** 1–720, integers. */
  rewardWithinHours: number;
  penaltyAfterHours: number;
  /** 0–1 000 000, a multiple of 100 (whole rupees). */
  rewardPaise: number;
  penaltyPaise: number;
}

/** `SpeedCatalogueOut` — the price-free tree franchise principals pick from. */
export interface SpeedCatalogue {
  nodes: {
    id: string;
    parentId: string | null;
    name: string;
    depth: number;
    isLeaf: boolean;
    isActive: boolean;
  }[];
  models: { id: string; nodeId: string; name: string; brandName: string }[];
}

/**
 * Whose rules a screen is showing — decides the URL, never sent as a body
 * field.
 */
export type AllowanceScope =
  | { kind: "franchise" } // the portal: its own franchisee
  | { kind: "home"; franchiseeId: string } // staff, editable
  | { kind: "franchisee"; franchiseeId: string }; // staff, read-only, any franchisee

/* ── base location ──────────────────────────────────────────────────────── */

/** `pincode` | `gps` | `map` | `manual` — what `BaseLocationOut.source` says. */
export type BaseSource = "pincode" | "gps" | "map" | "manual";

/** `BaseLocationOut`. Coordinates reach only a caller who can manage the technician. */
export interface BaseLocation {
  latitude: number;
  longitude: number;
  pincode: string | null;
  source: BaseSource;
  setAt: string;
  /** True when the technician set it themselves. */
  setBySelf: boolean;
  /** R9: who set it — null when that user was since deleted. */
  setByName: string | null;
  setByRole: string | null;
}

/**
 * The PUT body: a bare pincode, OR a point with its source — never both
 * (the server 422s). A manager may send `pincode`, `map` or `manual`; `gps`
 * is the technician's own device fix.
 */
export type BaseLocationInput =
  | { pincode: string }
  | { latitude: number; longitude: number; source: "map" | "manual" };

/* ── the ticket blocks ──────────────────────────────────────────────────── */

/** `TicketTravelOut` — the allowance frozen when the job was accepted. */
export interface TicketTravel {
  technicianId: string;
  acceptedAt: string;
  technicianType: TechnicianType;
  /** Null = no base when accepted. */
  baseSource: BaseSource | null;
  customerSource: "ticket" | "pincode" | null;
  straightKm: number;
  roadFactorPct: number;
  km: number;
  freeKm: number;
  stepKm: number;
  paisePerStep: number;
  maxPaisePerJob: number;
  amountPaise: number;
  reason: "no_base_location" | "no_customer_point" | null;
  /** The `travel` ledger row's amount; null when none, never 0. */
  creditedPaise: number | null;
  /** What the force-close form pre-fills and caps at. */
  forceCloseDefaultPaise: number;
  forceCloseMaxPaise: number;
}

/** `TicketSpeedOut` — measured from the frozen terms and the event log. */
export interface TicketSpeed {
  matchedOn: "model" | "node";
  matchedName: string;
  rewardWithinHours: number;
  penaltyAfterHours: number;
  rewardPaise: number;
  penaltyPaise: number;
  /** R1: the later of the accept and the slot's start. */
  clockStartedAt: string | null;
  acceptedAt: string | null;
  slotStart: string | null;
  completedAt: string | null;
  elapsedHours: number | null;
  partWaitHours: number | null;
  workingHours: number | null;
  outcome: "pending" | "reward" | "penalty" | "none" | "force_closed";
  ledgerEntryId: string | null;
  /** The ledger row's amount; null when there is no row, never 0. */
  paidPaise: number | null;
  capped: boolean;
  reversed: boolean;
}
