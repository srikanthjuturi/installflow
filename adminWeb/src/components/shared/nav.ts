import {
  AlertTriangle,
  Boxes,
  Coins,
  LayoutDashboard,
  ListFilter,
  Map,
  SlidersHorizontal,
  Tags,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/types";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /**
   * A count surfaced on the rail — the escalation queue only.
   *
   * A number here is a PLACEHOLDER, not a fact: `Sidebar` overrides the
   * escalation badge with the live queue length.
   */
  badge?: number;
  /** Child routes that should keep this item lit. */
  match?: string[];
  /**
   * Backend feature key required to see this entry and reach its route.
   * Absent = ungated (shown to every signed-in user).
   *
   * These mirror the server's feature catalog, so the rail can never offer a
   * screen the API would refuse.
   */
  feature?: string;
}

export interface NavGroup {
  name: string;
  items: NavItem[];
  /**
   * Roles the group is shown to. Absent means everyone.
   *
   * Presentation only — hiding a rail entry is not authorization (hard rule 8).
   * The route stays reachable by URL and the server is the authority on who
   * may act; this only keeps a rail free of links a role never uses.
   */
  roles?: Role[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    name: "Overview",
    items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard }],
  },
  {
    name: "Tickets",
    items: [
      {
        label: "Ticket List",
        to: "/tickets",
        icon: ListFilter,
        match: ["/tickets/"],
        feature: "jobs.view",
      },
    ],
  },
  {
    name: "Operations",
    items: [
      {
        label: "Escalation Queue",
        to: "/escalations",
        icon: AlertTriangle,
        // Overridden by `Sidebar` with the live queue length. Zero here rather
        // than the mock's 3: an unloaded badge must not claim there is work.
        badge: 0,
        match: ["/escalations/"],
        // Was ungated, on the reasoning that the domain puts escalations in the
        // Area Service Manager's hands. It does — but "ungated" meant every
        // signed-in user, several ranks below the ASM included, and this is the
        // screen that spends money and commits somebody's day. `jobs.assign` is
        // the key the three endpoints behind it carry, and the API pairs it
        // with a rank floor of area_manager that no Feature Access override can
        // lift. Hard rule 8: this hides the link, the server refuses the act.
        feature: "jobs.assign",
      },
      /* AI Review — hidden for now, not deleted. The slice is not built:
         nothing writes the `AI Review` status and `services/ai.ts` is still
         mock, so the rail would offer a queue that can only ever be empty
         under a badge of 4 invented rows. Uncomment this entry, the two routes
         in `routes.tsx`, the two `routeMeta` entries and the dashboard's
         attention card when verification actually ships — and put `ScanLine`
         back in the lucide import above, which lint drops while it is unused. */
      // {
      //   label: "AI Review",
      //   to: "/ai-review",
      //   icon: ScanLine,
      //   badge: 4,
      //   match: ["/ai-review/"],
      // },
    ],
  },
  {
    name: "Master Data",
    items: [
      {
        label: "Technicians",
        to: "/technicians",
        icon: Users,
        match: ["/technicians/"],
        feature: "technicians.view",
      },
      {
        label: "Penalty & Bonus",
        to: "/ledger",
        icon: Coins,
        feature: "earnings.view",
      },
      {
        label: "Vendors",
        to: "/vendors",
        icon: Boxes,
        // Its own feature since vendors became real and gained a GSTIN, a
        // contact and the brand relation to every product model. The server
        // also holds a National-Head rank floor that no per-company feature
        // override can lift, so this key alone does not open the screen.
        feature: "vendors.view",
      },
      {
        label: "Territory",
        to: "/territory",
        icon: Map,
        // Its own feature, so a National Head can see the territory without
        // also getting Vendors, Categories and Rules Config.
        feature: "territory.view",
      },
      {
        label: "Categories",
        to: "/categories",
        icon: Tags,
        // Its own feature since the product master became real — the screen
        // now writes, and `settings.view` would have handed that to anyone
        // who could open Rules Config.
        feature: "masters.view",
      },
    ],
  },
  {
    name: "Configuration",
    items: [
      {
        label: "Rules Config",
        to: "/settings/rules",
        icon: SlidersHorizontal,
        feature: "settings.view",
      },
      {
        label: "Users & Roles",
        to: "/settings/users",
        icon: UserCog,
        feature: "users.view",
      },
    ],
  },
];

/**
 * The feature a path requires, or `undefined` when it is ungated.
 *
 * Derived from NAV_GROUPS so the rail and the route guard can never disagree —
 * a link that is hidden is also unreachable by typing the URL.
 */
export function featureForPath(pathname: string): string | undefined {
  const items = NAV_GROUPS.flatMap((g) => g.items);

  const exact = items.find((i) => i.to === pathname);
  if (exact) return exact.feature;

  // Longest prefix wins, so /settings/users beats a hypothetical /settings.
  const prefixed = items
    .filter(
      (i) =>
        (i.to !== "/" && pathname.startsWith(`${i.to}/`)) ||
        i.match?.some((m) => pathname.startsWith(m))
    )
    .sort((a, b) => b.to.length - a.to.length)[0];

  return prefixed?.feature;
}

export { UserCog };
