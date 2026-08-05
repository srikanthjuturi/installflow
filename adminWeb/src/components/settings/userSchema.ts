import { z } from "zod";
import type { RegionTerritory, Role, User } from "@/types";

/**
 * Console access: who may sign in, as what, and over which slice of the
 * territory.
 *
 * Neither form here grants anything — RBAC is enforced server-side
 * (adminWeb/AGENTS.md hard rule 8). They record the role and scope requested
 * for a person; the server decides what a request is allowed to do.
 */

/** Widest scope in the hierarchy. An NH owns no region, so it is not a choice. */
export const NATIONAL_SCOPE = "All India";

/** Declared against the shared `Role` union, never re-declaring it. */
const ROLE_VALUES = ["NH", "RSH", "ASM", "Ops Staff"] as const satisfies readonly Role[];
const STATUS_VALUES = [
  "Active",
  "Invited",
  "Suspended",
] as const satisfies readonly User["status"][];

/** Hierarchy order, widest first. */
export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "NH", label: "NH · National Head" },
  { value: "RSH", label: "RSH · Regional Service Head" },
  { value: "ASM", label: "ASM · Area Service Manager" },
  { value: "Ops Staff", label: "Ops Staff · intake only" },
];

/**
 * "Scope" is a different thing per role — all of India, one region, or one
 * ASM area — so the control, its label and its error message all follow the
 * role rather than offering one free-text box for every case.
 */
export type ScopeKind = "national" | "region" | "area";

export const SCOPE_META: Record<
  Role,
  { kind: ScopeKind; label: string; placeholder: string; help: string; required: string }
> = {
  NH: {
    kind: "national",
    label: "Scope",
    placeholder: NATIONAL_SCOPE,
    help: "A National Head covers every region.",
    required: "",
  },
  RSH: {
    kind: "region",
    label: "Region",
    placeholder: "Select a region",
    help: "An RSH owns one region.",
    required: "Select a region",
  },
  ASM: {
    kind: "area",
    label: "Area",
    placeholder: "Select an area",
    help: "An ASM owns the pincode range of one area.",
    required: "Select an area",
  },
  "Ops Staff": {
    kind: "area",
    label: "Area",
    placeholder: "Select an area",
    help: "Ops Staff raise and track tickets for one area.",
    required: "Select an area",
  },
};

/**
 * Scope choices come from the territory map, so an RSH can only be given a
 * region that exists and an ASM only an area that has pincodes behind it.
 * `current` keeps an already-saved scope selectable while territory loads or
 * if the mapping later drops it.
 */
export function scopeOptions(
  role: Role,
  territory: RegionTerritory[] | undefined,
  current = "",
): string[] {
  const kind = SCOPE_META[role].kind;
  const options =
    kind === "national"
      ? [NATIONAL_SCOPE]
      : kind === "region"
        ? (territory?.map((t) => t.region) ?? [])
        : (territory?.flatMap((t) => t.asms.map((a) => a.area)) ?? []);

  return current && !options.includes(current) ? [...options, current] : options;
}

/** Changing role changes what scope means, so keep the pick only if it still fits. */
export function reconcileScope(
  role: Role,
  scope: string,
  territory: RegionTerritory[] | undefined,
): string {
  if (SCOPE_META[role].kind === "national") return NATIONAL_SCOPE;
  return scopeOptions(role, territory).includes(scope) ? scope : "";
}

/**
 * "Invited" is set by the invite and cleared when the person accepts — it is
 * never something an admin picks. A pending invite can still be suspended.
 */
export function statusOptions(current: User["status"]): User["status"][] {
  return current === "Invited" ? ["Invited", "Suspended"] : ["Active", "Suspended"];
}

/* ------------------------------------------------------------------ schemas */

const roleField = z.enum(ROLE_VALUES);
const statusField = z.enum(STATUS_VALUES);

/**
 * Console access is provisioned to a work mailbox, so a valid address is not
 * enough — the common personal providers are rejected by name.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "rediffmail.com",
]);

const workEmail = z
  .string()
  .trim()
  .min(1, "Work email is required")
  .pipe(z.email("Enter a valid email address"))
  .refine(
    (value) => !PERSONAL_DOMAINS.has(value.slice(value.lastIndexOf("@") + 1).toLowerCase()),
    "Use a work email address, not a personal one",
  );

/** Scope is optional for an NH only — every other role must own something. */
function checkScope(
  values: { role: Role; scope: string },
  ctx: z.RefinementCtx<{ role: Role; scope: string }>,
) {
  const meta = SCOPE_META[values.role];
  if (meta.kind === "national" || values.scope.trim()) return;
  ctx.addIssue({ code: "custom", path: ["scope"], message: meta.required });
}

export const inviteUserSchema = z
  .object({
    name: z.string().trim().min(2, "Full name is required"),
    email: workEmail,
    role: roleField,
    scope: z.string(),
  })
  .superRefine(checkScope);

export type InviteUserValues = z.infer<typeof inviteUserSchema>;

export const editAccessSchema = z
  .object({
    role: roleField,
    scope: z.string(),
    status: statusField,
  })
  .superRefine(checkScope);

export type EditAccessValues = z.infer<typeof editAccessSchema>;
