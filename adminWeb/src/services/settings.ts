import {
  ApiError,
  matches,
  mockPage,
  mockResponse,
  notFound,
  sortRows,
} from "./client";
import {
  AI_CONFIDENCE_MAX,
  AI_CONFIDENCE_MIN,
  AI_CONFIDENCE_THRESHOLD,
  CUSTOMER_WAIT_HOURS,
  ESCALATION_TRIGGER_HOURS,
} from "./rulesDefaults";
import type { ListParams, Page } from "@/types/api";
import type { Role, User } from "@/types";

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

/**
 * Bandwidth accounting. `count` is a plain jobs-per-day cap, which is what
 * the Technician record and the technician app both model; `weighted` is the
 * prototype's wording. Kept as a real choice rather than a display string so
 * the open decision is visible and settleable on this screen.
 */
export type BandwidthModel = "count" | "weighted";

export interface RulesConfig {
  /** Definitional, not configurable — an SLA type IS its window. */
  sla: SlaRule[];
  penalty: PenaltyBand[];
  /** Per technician, per month. */
  penaltyCap: number;
  ai: AiThresholdRule;
  /** Hours of customer silence before a slot request auto-escalates. */
  slotConfirmTimeoutHours: number;
  /** Hours before a confirmed slot at which an unassigned ticket escalates. */
  escalationTriggerHours: number;
  /** Hours of customer silence before manager closure becomes available. */
  customerWaitHours: number;
  bandwidthModel: BandwidthModel;
}

/* ---------------------------------------------------------------- rules data */

const RULES: RulesConfig = {
  sla: [
    { label: "24h SLA window", value: "24 hours from slot confirmation" },
    { label: "48h SLA window", value: "48 hours from slot confirmation" },
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

  slotConfirmTimeoutHours: 6,
  escalationTriggerHours: ESCALATION_TRIGGER_HOURS,
  customerWaitHours: CUSTOMER_WAIT_HOURS,

  /**
   * ⚠ OPEN DECISION — "weighted" is the prototype's wording and contradicts
   * the plain jobs-per-day cap used everywhere else: mobileapp/AGENTS.md
   * calls bandwidth a simple 1–12/day count, and this prototype's own
   * technician records store plain counts (bwUsed 3 / bwTotal 5) with no
   * weight anywhere. Rendered faithfully as the served default; now that it
   * is a real field, this screen is where the decision gets settled.
   * See adminWeb/AGENTS.md, "Decisions still open" §2.
   */
  bandwidthModel: "weighted",
};

export function getRulesConfig(): Promise<RulesConfig> {
  return mockResponse(() => RULES);
}

export interface RulesConfigDraft {
  penalty: Array<{ band: string; amount: number }>;
  penaltyCap: number;
  aiThreshold: number;
  slotConfirmTimeoutHours: number;
  escalationTriggerHours: number;
  customerWaitHours: number;
  bandwidthModel: BandwidthModel;
}

/**
 * Applies the draft to the served config.
 *
 * This persists for the session only — there is no rules API yet. It is a
 * genuine write rather than a no-op so the screen behaves like the real one:
 * saving, then re-reading, returns what you saved.
 *
 * ⚠ Whatever is saved here does NOT reach the technician app. Until the
 * penalty-band contradiction is settled, the two can still disagree about
 * live money — see the note on `penalty` above.
 */
export function saveRulesConfig(draft: RulesConfigDraft): Promise<RulesConfig> {
  return mockResponse(() => {
    if (draft.penalty.some((b) => b.amount < 0)) {
      throw new ApiError("A penalty cannot be negative", 422);
    }
    RULES.penalty = draft.penalty.map((b) => ({
      ...b,
      basis: "flat" as const,
    }));
    RULES.penaltyCap = draft.penaltyCap;
    RULES.ai = { ...RULES.ai, threshold: draft.aiThreshold };
    RULES.slotConfirmTimeoutHours = draft.slotConfirmTimeoutHours;
    RULES.escalationTriggerHours = draft.escalationTriggerHours;
    RULES.customerWaitHours = draft.customerWaitHours;
    RULES.bandwidthModel = draft.bandwidthModel;
    return RULES;
  });
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

/** Minutes in each suffix the "last active" strings use. */
const LAST_ACTIVE_UNIT: Record<string, number> = {
  m: 1,
  h: 60,
  d: 1440,
  w: 10080,
};

/**
 * "Last active" is a human string — "Online", "40m ago", "6d ago", "—".
 * Sorting it alphabetically would put "1h ago" beside "15m ago" and call it a
 * date, so it is compared as **minutes since last seen**: ascending is most
 * recent first, "Online" is 0, and a user who has never signed in returns
 * `null`, which sorts last in both directions.
 */
function minutesSinceActive(last: string): number | null {
  const value = last.trim();
  if (value === "Online") return 0;

  const match = /^(\d+)\s*([mhdw])\s+ago$/i.exec(value);
  if (!match) return null;

  return Number(match[1]) * LAST_ACTIVE_UNIT[match[2].toLowerCase()];
}

const USER_SORT = {
  name: (u: User) => u.name,
  email: (u: User) => u.email,
  role: (u: User) => u.role,
  region: (u: User) => u.region,
  status: (u: User) => u.status,
  last: (u: User) => minutesSinceActive(u.last),
};

/**
 * Console users, server-paged.
 *
 * Search, filters, sort and the slice belong to the server; this stands in for
 * it. With no `sortBy` the seeded order is preserved, which is the order the
 * approved prototype shows.
 */
export function listUsers(params: ListParams = {}): Promise<Page<User>> {
  return mockPage(() => {
    const { role, status } = params.filters ?? {};

    const rows = USERS.filter(
      (u) =>
        matches(u, ["name", "email"], params.search) &&
        (!role || u.role === role) &&
        (!status || u.status === status)
    );

    return sortRows(rows, params.sortBy, params.sortDir, USER_SORT);
  }, params);
}

/* ----------------------------------------------------------- user mutations */

/**
 * `User.region` is the scope column: "All India" for an NH, a region for an
 * RSH, an ASM area for an ASM or Ops Staff. The input calls it `scope` because
 * that is what the form is choosing.
 */
export interface InviteUserInput {
  name: string;
  email: string;
  role: Role;
  scope: string;
  /** Optional profile photo — the URL a crop was uploaded to. Mock-only for
   *  now; the live path is `POST /users`, whose API refuses inline image data. */
  photoUrl?: string;
}

/**
 * An invite requests access; it does not grant it. The new user is created
 * "Invited" — never "Active" — and stays there until they accept. RBAC is
 * enforced server-side, so this record is a statement of intent, not a
 * permission.
 */
export function inviteUser(input: InviteUserInput): Promise<User> {
  return mockResponse(() => {
    const email = input.email.trim().toLowerCase();
    if (USERS.some((u) => u.email.toLowerCase() === email)) {
      throw new ApiError(`${email} already has console access`, 409);
    }

    const nextId = Math.max(...USERS.map((u) => Number(u.id.slice(2)))) + 1;
    const user: User = {
      id: `U-${nextId}`,
      name: input.name.trim(),
      email,
      photoUrl: input.photoUrl,
      role: input.role,
      region: input.scope,
      status: "Invited",
      /** Nothing to report until they sign in — the prototype's em dash. */
      last: "—",
    };
    USERS.push(user);
    return user;
  });
}

export interface UpdateUserAccessInput {
  id: string;
  role: Role;
  scope: string;
  status: User["status"];
}

/**
 * Role, scope and status only. Name and email are account identity, not
 * access, and are not editable from the access form.
 */
export function updateUserAccess(input: UpdateUserAccessInput): Promise<User> {
  return mockResponse(() => {
    const user = USERS.find((u) => u.id === input.id);
    if (!user) notFound("User", input.id);
    user.role = input.role;
    user.region = input.scope;
    user.status = input.status;
    return user;
  });
}
