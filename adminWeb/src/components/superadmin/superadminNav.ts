import type { LucideIcon } from "lucide-react";
import { BadgeIndianRupee, Building2, Globe2, SlidersHorizontal } from "lucide-react";

/**
 * The superadmin console's navigation.
 *
 * A third table alongside `shared/nav.ts` and `vendor/portalNav.ts`, for the
 * same reason those two are separate: each surface has its own guard, and one
 * shared longest-prefix search deciding all three is how a rule for one starts
 * shadowing a sibling in another.
 *
 * There is no `feature` key here and there should not be. A superadmin holds no
 * membership, so `require_feature` on the API refuses them outright and
 * `SUPERADMIN_FEATURES` is a fixed list; the surface is gated once, by
 * `RequireSuperadmin` in `routes.tsx`, on the session's `superadmin` flag.
 * Adding a feature key would imply a per-screen grant that does not exist.
 */
export interface SuperadminNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Draws a live count beside the label — see `SuperadminSidebar`. */
  badge?: "waitingRecharges";
}

export const SUPERADMIN_NAV: SuperadminNavItem[] = [
  { label: "Companies", to: "/companies", icon: Building2 },
  // Companies that say they have paid for credits. The badge is how many are
  // waiting for a decision — the same number the header's bell carries.
  {
    label: "Recharges",
    to: "/recharges",
    icon: BadgeIndianRupee,
    badge: "waitingRecharges",
  },
  // What a company is given and what a ticket costs, and where recharges are paid.
  { label: "Rules", to: "/rules", icon: SlidersHorizontal },
  { label: "Geography", to: "/geography", icon: Globe2 },
];

/** Which entry is lit. Exact, then longest prefix — same rule as the portal. */
export function activeSuperadminPath(pathname: string): string | undefined {
  const exact = SUPERADMIN_NAV.find((i) => i.to === pathname);
  if (exact) return exact.to;
  return SUPERADMIN_NAV.filter((i) => pathname.startsWith(`${i.to}/`)).sort(
    (a, b) => b.to.length - a.to.length
  )[0]?.to;
}
