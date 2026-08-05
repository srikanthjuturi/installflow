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

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Live count surfaced on the rail — escalations and AI review only. */
  badge?: number;
  /** Child routes that should keep this item lit. */
  match?: string[];
}

export interface NavGroup {
  name: string;
  items: NavItem[];
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
      },
      { label: "Manual Entry", to: "/tickets/new", icon: FileText },
      { label: "Bulk Upload", to: "/tickets/import", icon: Upload },
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
      },
      { label: "Penalty & Bonus", to: "/ledger", icon: Coins },
      { label: "Vendors", to: "/vendors", icon: Boxes },
      { label: "Territory", to: "/territory", icon: Map },
      { label: "Categories", to: "/categories", icon: Tags },
    ],
  },
  {
    name: "Configuration",
    items: [
      { label: "Rules Config", to: "/settings/rules", icon: SlidersHorizontal },
      { label: "Users & Roles", to: "/settings/users", icon: UserCog },
    ],
  },
];

export { UserCog };
