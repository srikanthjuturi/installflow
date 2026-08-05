import { mockResponse } from "./client";
import {
  AI_CONFIDENCE_MAX,
  AI_CONFIDENCE_MIN,
  AI_CONFIDENCE_THRESHOLD,
} from "./rulesDefaults";
import type { User } from "@/types";

/**
 * Settings: the rules engine and console access.
 *
 * Both screens are read-mostly. Every value below is lifted verbatim from the
 * approved prototype's `RULES` / `USERS` objects — see the two ⚠ notes, which
 * are open decisions, not typos to be tidied away.
 */

/* --------------------------------------------------------------- rules types */

/** A named window or trigger. `label` is the rule, `value` is its setting. */
export interface SlaRule {
  label: string;
  value: string;
}

/**
 * A cancellation penalty band. Amounts are numbers, not the prototype's
 * pre-formatted "₹300" strings, so every rupee figure in the app renders
 * through `utils/money.ts` and can never disagree with the ledger's format.
 */
export interface PenaltyBand {
  band: string;
  amount: number;
  /** All four bands are flat, not a percentage of the job value. */
  basis: "flat";
}

export interface AiThresholdRule {
  /** Percent. Below this, a verification is flagged for manual ASM review. */
  threshold: number;
  min: number;
  max: number;
}

export interface RulesConfig {
  sla: SlaRule[];
  penalty: PenaltyBand[];
  /** Per technician, per month. */
  penaltyCap: number;
  ai: AiThresholdRule;
  timing: SlaRule[];
}

/* ---------------------------------------------------------------- rules data */

const RULES: RulesConfig = {
  sla: [
    { label: "24h SLA window", value: "24 hours from slot confirmation" },
    { label: "48h SLA window", value: "48 hours from slot confirmation" },
    { label: "Slot-confirm timeout", value: "6 hours, then auto-escalate" },
    { label: "Escalation trigger", value: "Unassigned within 4h of slot" },
  ],

  /**
   * ⚠ OPEN DECISION — these contradict the technician app.
   *
   * This prototype (and therefore this screen): ₹300 (>4h) · ₹500 (2–4h) ·
   * ₹800 (<2h) · ₹1,200 (no-show), capped at ₹5,000/technician/month.
   *
   * `mobileapp/AGENTS.md` and the technician cancel screen: ₹80 (>8h) ·
   * ₹150 (4–8h) · ₹250 (<4h). Different amounts *and* different band
   * boundaries — three bands against four, cutting at 8h/4h instead of
   * 4h/2h, with no no-show band at all.
   *
   * The same cancellation would therefore charge the technician one figure
   * and credit the ASM's pool another. Rendered faithfully from the approved
   * web prototype and deliberately NOT reconciled: this needs a business
   * ruling before either side binds to an API. See adminWeb/AGENTS.md,
   * "Decisions still open" §1.
   */
  penalty: [
    { band: "> 4h before slot", amount: 300, basis: "flat" },
    { band: "2–4h before slot", amount: 500, basis: "flat" },
    { band: "< 2h before slot", amount: 800, basis: "flat" },
    { band: "No-show", amount: 1200, basis: "flat" },
  ],
  penaltyCap: 5000,

  /**
   * One declaration, two readers: this screen presents the threshold as an
   * adjustable slider and the AI queue uses it to label rows "below
   * threshold". Both read `rulesDefaults.ts`, so they cannot drift.
   */
  ai: {
    threshold: AI_CONFIDENCE_THRESHOLD,
    min: AI_CONFIDENCE_MIN,
    max: AI_CONFIDENCE_MAX,
  },

  timing: [
    { label: "Wait period before manager closure", value: "48 hours" },
    { label: "Slot-confirm timeout → auto-escalate", value: "6 hours" },
    /**
     * ⚠ OPEN DECISION — "Weighted by job type" contradicts the plain
     * jobs-per-day cap used everywhere else: `mobileapp/AGENTS.md` calls
     * bandwidth a simple 1–12/day count, and this very prototype's own
     * technician records store plain counts (`bwUsed 3 / bwTotal 5`) with
     * no weight anywhere. Rendered faithfully; not reconciled. See
     * adminWeb/AGENTS.md, "Decisions still open" §2.
     */
    { label: "Bandwidth model", value: "Weighted by job type" },
  ],
};

export function getRulesConfig(): Promise<RulesConfig> {
  return mockResponse(() => RULES);
}

export interface RulesConfigDraft {
  aiThreshold: number;
}

/**
 * Mock no-op. Nothing persists — there is no rules API yet, and inventing
 * local persistence would let this screen disagree with the technician app
 * about live money. It resolves so the screen can prove its saving state,
 * and deliberately returns the draft rather than mutating `RULES`.
 */
export function saveRulesConfig(draft: RulesConfigDraft): Promise<RulesConfigDraft> {
  return mockResponse(() => draft);
}

/* ---------------------------------------------------------------- users data */

/**
 * Console users. The customer and the technician never log in here.
 *
 * Scope is hierarchical: NH sees all regions → RSH one region → ASM a pincode
 * range → Ops Staff intake only. What this screen shows is a *record* of that
 * scope; RBAC itself is enforced server-side (adminWeb/AGENTS.md hard rule 8),
 * so nothing here grants access.
 */
const USERS: User[] = [
  {
    id: "U-1001",
    name: "Arjun Mehta",
    email: "arjun.mehta@installflow.in",
    role: "NH",
    region: "All India",
    status: "Active",
    last: "2h ago",
  },
  {
    id: "U-1014",
    name: "Kavita Rao",
    email: "kavita.rao@installflow.in",
    role: "RSH",
    region: "West",
    status: "Active",
    last: "40m ago",
  },
  {
    id: "U-1022",
    name: "Ravi Sharma",
    email: "ravi.sharma@installflow.in",
    role: "ASM",
    region: "Pune",
    status: "Active",
    last: "Online",
  },
  {
    id: "U-1030",
    name: "Sneha Iyer",
    email: "sneha.iyer@installflow.in",
    role: "ASM",
    region: "Mumbai",
    status: "Active",
    last: "1h ago",
  },
  {
    id: "U-1041",
    name: "Dinesh Kumar",
    email: "dinesh.kumar@installflow.in",
    role: "Ops Staff",
    region: "Pune",
    status: "Active",
    last: "15m ago",
  },
  {
    id: "U-1052",
    name: "Pooja Nanda",
    email: "pooja.nanda@installflow.in",
    role: "Ops Staff",
    region: "Pune",
    status: "Invited",
    last: "—",
  },
  {
    id: "U-1060",
    name: "Harish Patel",
    email: "harish.patel@installflow.in",
    role: "RSH",
    region: "North",
    status: "Suspended",
    last: "6d ago",
  },
];

export function listUsers(): Promise<User[]> {
  return mockResponse(() => USERS);
}
