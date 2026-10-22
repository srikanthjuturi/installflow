import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Coins,
  FileSpreadsheet,
  IndianRupee,
  ListFilter,
  Users,
} from "lucide-react";
import { longestMatch } from "@/components/shared/navMatch";

/**
 * The franchise portal's own navigation table — the twin of
 * `vendor/portalNav.ts`, and read that file's header, because every reason
 * there applies here a third time (this one after it):
 *
 * 1. `featureForFranchisePath` is consulted by `RequireFranchiseFeature` for
 *    every `/franchise/*` path. One table serving two guards means one
 *    longest-prefix search deciding both, and the `/franchise/technicians/`
 *    match prefix is exactly the kind of rule that shadows a sibling.
 * 2. This table is flat — a handful of items, no groups.
 * 3. **`feature` is REQUIRED.** `useFeatureAccess().has(undefined)` returns
 *    TRUE, so an optional key silently means "visible to every franchise
 *    user" — the polarity the vendor portal's guard already refuses. A new
 *    entry without a key is unreachable (the guard denies what this table does
 *    not name); an OPTIONAL key is the worse failure, visible to everybody.
 */
export interface FranchiseNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  match?: string[];
  /** Required — there is no ungated franchise SCREEN. */
  feature: string;
}

/**
 * The rail order IS the landing preference: `franchiseLanding` takes the first
 * held entry, so a franchisee admin (everything minus the parts keys Task 13
 * adds) lands on Technicians and a facility role (only `franchise.tickets`,
 * until Task 13's parts queue slots in above it) lands on Tickets.
 *
 * `match` entries keep a detail route's rail light without claiming a sibling:
 * `/franchise/technicians/` covers the profile and its job history, and the
 * profile's id route must never shade under a ticket entry.
 */
export const FRANCHISE_NAV: FranchiseNavItem[] = [
  {
    label: "Technicians",
    to: "/franchise/technicians",
    icon: Users,
    match: ["/franchise/technicians/"],
    feature: "franchise.technicians",
  },
  {
    label: "UPI changes",
    to: "/franchise/upi-changes",
    icon: ArrowLeftRight,
    feature: "franchise.payouts",
  },
  {
    label: "Redemptions",
    to: "/franchise/redemptions",
    icon: IndianRupee,
    match: ["/franchise/redemptions/"],
    feature: "franchise.payouts",
  },
  {
    label: "Penalty & bonus pool",
    to: "/franchise/pool",
    icon: Coins,
    feature: "franchise.pool",
  },
  {
    label: "Employee statements",
    to: "/franchise/statements",
    icon: FileSpreadsheet,
    feature: "franchise.statements",
  },
  {
    label: "Tickets",
    to: "/franchise/tickets",
    icon: ListFilter,
    match: ["/franchise/tickets/"],
    feature: "franchise.tickets",
  },
];

/**
 * Paths any signed-in franchise user reaches whatever their features: the bare
 * `/franchise` (it only redirects, so gating it could loop when the landing is
 * itself unreachable), their own record, their own password and their own bell.
 *
 * An explicit allow-list, because `RequireFranchiseFeature` DENIES anything it
 * does not recognise — see `RequirePortalFeature` for that reasoning.
 */
export const FRANCHISE_UNGATED = new Set([
  "/franchise",
  "/franchise/account",
  "/franchise/notifications",
  "/franchise/password",
]);

/** Every path the portal knows — feature-independent, because the GUARD must
    recognise a path even when this user's features do not light it up. */

/** `undefined` means "not a franchise portal screen", which the guard reads as deny. */
export function featureForFranchisePath(
  pathname: string
): string | undefined {
  return longestMatch(FRANCHISE_NAV, pathname)?.feature;
}

/** The rail entry that is lit, by the same longest-prefix rule the guard uses. */
export function activeFranchisePath(
  items: FranchiseNavItem[],
  pathname: string
): string | undefined {
  return longestMatch(items, pathname)?.to;
}

/** What THIS user sees — the table filtered by the features they actually hold. */
export function franchiseNav(has: (key?: string) => boolean): FranchiseNavItem[] {
  return FRANCHISE_NAV.filter((item) => has(item.feature));
}

/**
 * Where a franchise session lands. The first held rail entry — `FRANCHISE_NAV`'s
 * order is the preference — else `/franchise/account`.
 *
 * The fallback is the ACCOUNT page deliberately: it is in FRANCHISE_UNGATED, so
 * the guard can never redirect into a loop, however empty a company's override
 * has made this account's feature set — naming the bare `/franchise` here would
 * land the redirector in its own redirect. A facility role with only
 * `franchise.tickets` lands on `/franchise/tickets` (the fifth entry — see the
 * rail-order note above); Task 13's parts queue lands them there instead, with
 * no change to this function.
 */
export function franchiseLanding(
  has: (key?: string) => boolean
): string {
  return franchiseNav(has)[0]?.to ?? "/franchise/account";
}