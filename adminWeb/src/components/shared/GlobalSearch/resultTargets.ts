import { Boxes, ListFilter, Tags, UserCog, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SearchHit, SearchType } from "@/types/search";

/**
 * What each kind of result is called, and where clicking it goes.
 *
 * **The client owns the routes, not the API.** The server answers with display
 * strings and an id; a backend that knew `/tickets/:id` would be a second place
 * route paths live, and the two would disagree the first time one moved.
 *
 * Labels and icons are the sidebar's, from `nav.ts` — a result group and the
 * nav item it leads to should not be two different words for one screen.
 */
interface ResultTarget {
  label: string;
  icon: LucideIcon;
  /** Where this hit lives. */
  to: (hit: SearchHit) => string;
}

/**
 * Two of these five deep-link to a record; three land on a filtered list.
 *
 * Users, vendors and the product master have no detail route — they are edited
 * in place on their list screen — so the honest destination is that screen with
 * the search already applied, which is also why those pages now seed their
 * filter from the query string.
 */
export const RESULT_TARGETS: Record<SearchType, ResultTarget> = {
  ticket: {
    label: "Tickets",
    icon: ListFilter,
    to: (hit) => `/tickets/${hit.id}`,
  },
  technician: {
    label: "Technicians",
    icon: Users,
    to: (hit) => `/technicians/${hit.id}`,
  },
  user: {
    label: "Users",
    icon: UserCog,
    to: (hit) => `/settings/users?search=${encodeURIComponent(hit.title)}`,
  },
  vendor: {
    label: "Vendors",
    icon: Boxes,
    to: (hit) => `/vendors?search=${encodeURIComponent(hit.title)}`,
  },
  product: {
    label: "Products",
    icon: Tags,
    // The master is one page with the whole tree on it, so a hit scrolls to its
    // node rather than opening anything.
    to: (hit) => `/categories?focus=${encodeURIComponent(hit.id)}`,
  },
};

/**
 * A count that never overstates itself.
 *
 * The server stops counting at 100 because every match is a sequential scan, so
 * past that the honest answer is "at least this many" — not a number nobody
 * measured.
 */
export function formatTotal(total: number, capped: boolean): string {
  return capped ? `${total - 1}+` : String(total);
}
