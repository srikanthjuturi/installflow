import {
  AlertTriangle,
  Boxes,
  Coins,
  FileText,
  LayoutDashboard,
  ListFilter,
  Map,
  ScanLine,
  SlidersHorizontal,
  Tags,
  Upload,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/types";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Live count surfaced on the rail — escalations and AI review only. */
  badge?: number;
  /** Child routes that should keep this item lit. */
  match?: string[];
  /**
   * Backend feature key required to see this entry and reach its route.
   * Absent = ungated (shown to every signed-in user).
   *
   * These mirror the server's feature catalog, so the rail can never offer a
   * screen the API would refuse. Escalations and AI review are deliberately
   * ungated: the domain puts both in the Area Service Manager's hands.
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
      {
        label: "Manual Entry",
        to: "/tickets/new",
        icon: FileText,
        feature: "jobs.create",
      },
      {
        label: "Bulk Upload",
        to: "/tickets/import",
        icon: Upload,
        feature: "jobs.create",
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
        badge: 3,
        match: ["/escalations/"],
      },
      {
        label: "AI Review",
        to: "/ai-review",
        icon: ScanLine,
        badge: 4,
        match: ["/ai-review/"],
      },
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
        feature: "settings.view",
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
