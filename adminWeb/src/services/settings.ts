import {
  ApiError,
  matches,
  mockPage,
  mockResponse,
  notFound,
  sortRows,
} from "./client";
import { apiDelete, apiGet, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type { Role, User } from "@/types";

/**
 * Settings: the rules engine and console access.
 *
 * The rules half is REAL — `GET`/`PUT /settings/rules`, one row per company in
 * `company_rules`. It was a module-level object that died with the browser tab
 * until the table existed, which is why this file mixes a live slice with a
 * mock one: console users are still the prototype's `USERS`.
 */

/* --------------------------------------------------------------- rules types */

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
  /** The slider's ends, served rather than hardcoded — `core/rules.LIMITS` on
   *  the API is the one declaration, and the CHECK constraint reads it too. */
  min: number;
  max: number;
}

/**
 * Everything on this screen is something an admin can CHANGE.
 *
 * SLA windows used to sit here as a read-only card and were removed: the
 * service levels are ticket vocabulary, not policy — `SERVICE_LEVEL_HOURS` in
 * the API's `core/tickets.py`, beside the statuses and proof kinds — so no
 * rules endpoint would ever serve them. Carried here they went stale unseen,
 * ending up naming two levels where there are four and starting the clock at
 * slot confirmation, which is the reading the backend explicitly rejected.
 * The per-ticket SLA column and badge are the live answer.
 */
export interface RulesConfig {
  penalty: PenaltyBand[];
  /** Per technician, per month. */
  penaltyCap: number;
  /**
   * The escalation bonus chips, in RUPEES, ascending.
   *
   * The counterpart to `penalty` and the reason both live here: penalties fund
   * the pool and the pool funds these, so the money going out belongs beside
   * the money coming in. The API agrees these are configuration rather than
   * domain vocabulary — `BonusRequest` enforces only `gt=0` and explicitly
   * declines to constrain the amount to the four bands, because they are "a
   * design decision about a picker".
   *
   * Rupees, not paise: the bonus page converts at the API boundary, and every
   * other money figure on this screen is rupees too.
   */
  bonusAmounts: number[];
  ai: AiThresholdRule;
  /** Percent of the SLA window that must remain before a ticket stops reading
   *  "On track" and starts reading "Due soon". Repaints the ticket list. */
  slaWarnAtPct: number;
  /** Hours of customer silence before a slot request auto-escalates. */
  slotConfirmTimeoutHours: number;
  /** Hours before a confirmed slot at which an unassigned ticket escalates. */
  escalationTriggerHours: number;
  /** Hours of customer silence before manager closure becomes available. */
  customerWaitHours: number;
  /** Minutes a funded re-notification is protected from being escalated again.
   *  Too short and a bonus is a flicker rather than an offer. */
  renotifyGraceMinutes: number;
  /** Minutes before a slot that the technician is pushed a reminder. */
  slotReminderMinutes: number;
  /** Minutes before a slot that the CUSTOMER is WhatsApped the technician's
   *  name and number. Independent of the reminder above: warning technicians
   *  and warning customers at different distances is a policy, not a mistake. */
  customerNoticeMinutes: number;
  /** Metres the technician's live site photo may be from the customer's
   *  address. Only applies to a ticket whose address was picked off a map; one
   *  typed by hand is verified against its pincode instead. */
  geoRadiusM: number;
}

/* ---------------------------------------------------------------- rules API */

/**
 * What the wire carries. Flat, because that is the shape `PUT` takes and the
 * shape the form submits; `RulesConfig` groups the AI trio for the slider's
 * benefit, and `_toConfig` below is the one place the two shapes meet.
 *
 * Rupees throughout. The API stores paise (its hard rule 9) and converts at its
 * own boundary, so nothing on this side ever multiplies by a hundred.
 */
interface RulesPayload {
  penalty: Array<{ band: string; amount: number }>;
  penaltyCap: number;
  bonusAmounts: number[];
  aiThreshold: number;
  aiThresholdMin: number;
  aiThresholdMax: number;
  slaWarnAtPct: number;
  slotConfirmTimeoutHours: number;
  escalationTriggerHours: number;
  customerWaitHours: number;
  renotifyGraceMinutes: number;
  slotReminderMinutes: number;
  customerNoticeMinutes: number;
  geoRadiusM: number;
}

function _toConfig(r: RulesPayload): RulesConfig {
  return {
    // `basis` is not served: all four bands are flat and always have been, so
    // it is a fact about the shape rather than a value a company sets.
    penalty: r.penalty.map((b) => ({ ...b, basis: "flat" as const })),
    penaltyCap: r.penaltyCap,
    bonusAmounts: r.bonusAmounts,
    ai: {
      threshold: r.aiThreshold,
      min: r.aiThresholdMin,
      max: r.aiThresholdMax,
    },
    slaWarnAtPct: r.slaWarnAtPct,
    slotConfirmTimeoutHours: r.slotConfirmTimeoutHours,
    escalationTriggerHours: r.escalationTriggerHours,
    customerWaitHours: r.customerWaitHours,
    renotifyGraceMinutes: r.renotifyGraceMinutes,
    slotReminderMinutes: r.slotReminderMinutes,
    customerNoticeMinutes: r.customerNoticeMinutes,
    geoRadiusM: r.geoRadiusM,
  };
}

export async function getRulesConfig(): Promise<RulesConfig> {
  return _toConfig(await apiGet<RulesPayload>("/settings/rules"));
}

/* --------------------------------------------------- per-category overrides */

/**
 * One catalogue node's overrides. **Every field is nullable, and null means
 * inherit** — that is the whole mechanism.
 *
 * `penaltyCap` is deliberately absent. A monthly cap bounds a TECHNICIAN across
 * every job they took, so it cannot have a different answer per product; it
 * stays company-wide. See `core.rules.NODE_OVERRIDABLE_KEYS`.
 */
export interface NodeRuleValues {
  /** All four bands or none — a list is overridden whole. */
  penalty: number[] | null;
  bonusAmounts: number[] | null;
  aiThreshold: number | null;
  slaWarnAtPct: number | null;
  slotConfirmTimeoutHours: number | null;
  escalationTriggerHours: number | null;
  customerWaitHours: number | null;
  renotifyGraceMinutes: number | null;
  slotReminderMinutes: number | null;
  customerNoticeMinutes: number | null;
  geoRadiusM: number | null;
}

/** The wire names of everything a node may override. */
export type NodeRuleField = keyof NodeRuleValues;

export interface NodeRulesConfig {
  nodeId: string;
  /** Root first, including the node itself — what the scope selector prints. */
  path: string[];
  /** What this node sets. Every null is a field it inherits. */
  own: NodeRuleValues;
  /** What a ticket raised on this node would actually be stamped with. The
   *  placeholders in every empty box. */
  effective: RulesConfig;
  /** Per field, the ancestor that supplied the effective value. Absent when it
   *  came from the company baseline — which is what the form says instead. */
  inheritedFrom: Partial<Record<NodeRuleField, string>>;
}

interface NodeRulesPayload {
  nodeId: string;
  path: string[];
  own: NodeRuleValues;
  effective: RulesPayload;
  inheritedFrom: Partial<Record<NodeRuleField, string>>;
}

function _toNodeConfig(r: NodeRulesPayload): NodeRulesConfig {
  return { ...r, effective: _toConfig(r.effective) };
}

export async function getNodeRules(nodeId: string): Promise<NodeRulesConfig> {
  return _toNodeConfig(
    await apiGet<NodeRulesPayload>(`/settings/rules/nodes/${nodeId}`)
  );
}

/**
 * Replace this node's overrides. A body of all nulls deletes the row.
 *
 * *Reset to inherited* does NOT come through here — it sends the DELETE below.
 * The two ends up in the same place, and this comment used to claim the button
 * sent an all-null body, which mattered: the all-null branch validated and the
 * DELETE did not, so the sentence described the safe path while the button took
 * the other one.
 *
 * The server validates the RESOLVED set — this node's and every other node
 * carrying an override — so a value that is fine on its own but inverts an
 * inherited window comes back as a 400 naming the category. Nothing on this
 * side can check that: the form only holds one node's worth of the answer.
 */
export async function saveNodeRules(
  nodeId: string,
  values: NodeRuleValues
): Promise<NodeRulesConfig> {
  return _toNodeConfig(
    await apiPut<NodeRulesPayload>(`/settings/rules/nodes/${nodeId}`, values)
  );
}

export async function clearNodeRules(nodeId: string): Promise<NodeRulesConfig> {
  return _toNodeConfig(
    await apiDelete<NodeRulesPayload>(`/settings/rules/nodes/${nodeId}`)
  );
}

/**
 * A whole replacement, not a patch — `PUT`, and every field required.
 *
 * Two of these rules constrain each other (the escalation trigger has to be
 * shorter than the slot-confirm timeout), so a partial body would mean
 * validating a new value against one that might itself be changing in the same
 * request. One shape in, one shape out.
 *
 * The band LABELS are not sent. They are domain — `core/rules.py` owns them —
 * and a client that could rename "< 2h before slot" could describe a rule as
 * something it is not.
 */
export interface RulesConfigDraft {
  penalty: number[];
  penaltyCap: number;
  bonusAmounts: number[];
  aiThreshold: number;
  slaWarnAtPct: number;
  slotConfirmTimeoutHours: number;
  escalationTriggerHours: number;
  customerWaitHours: number;
  renotifyGraceMinutes: number;
  slotReminderMinutes: number;
  customerNoticeMinutes: number;
  geoRadiusM: number;
}

/**
 * Saves to `company_rules`, for this company, permanently.
 *
 * Answers with what is now STORED rather than echoing the draft, which is what
 * lets the screen re-seed its form from the response and notice anything the
 * server adjusted or refused.
 */
export async function saveRulesConfig(
  draft: RulesConfigDraft
): Promise<RulesConfig> {
  return _toConfig(await apiPut<RulesPayload>("/settings/rules", draft));
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
    email: "arjun.mehta@reliancegreentech.in",
    role: "NH",
    region: "All India",
    status: "Active",
    last: "2h ago",
  },
  {
    id: "U-1014",
    name: "Kavita Rao",
    email: "kavita.rao@reliancegreentech.in",
    role: "RSH",
    region: "West",
    status: "Active",
    last: "40m ago",
  },
  {
    id: "U-1022",
    name: "Ravi Sharma",
    email: "ravi.sharma@reliancegreentech.in",
    role: "ASM",
    region: "Pune",
    status: "Active",
    last: "Online",
  },
  {
    id: "U-1030",
    name: "Sneha Iyer",
    email: "sneha.iyer@reliancegreentech.in",
    role: "ASM",
    region: "Mumbai",
    status: "Active",
    last: "1h ago",
  },
  {
    id: "U-1041",
    name: "Dinesh Kumar",
    email: "dinesh.kumar@reliancegreentech.in",
    role: "Ops Staff",
    region: "Pune",
    status: "Active",
    last: "15m ago",
  },
  {
    id: "U-1052",
    name: "Pooja Nanda",
    email: "pooja.nanda@reliancegreentech.in",
    role: "Ops Staff",
    region: "Pune",
    status: "Invited",
    last: "—",
  },
  {
    id: "U-1060",
    name: "Harish Patel",
    email: "harish.patel@reliancegreentech.in",
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
