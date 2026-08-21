import type { LucideIcon } from "lucide-react";
import { Building2, Globe2 } from "lucide-react";

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
}

export const SUPERADMIN_NAV: SuperadminNavItem[] = [
  { label: "Companies", to: "/companies", icon: Building2 },
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
