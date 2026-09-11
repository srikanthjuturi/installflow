import type { LucideIcon } from "lucide-react";
import { FileText, ListFilter, Package, Tags, UserCog } from "lucide-react";
import type { IntakeChannel } from "@/types/vendor";

/**
 * The vendor portal's own navigation table.
 *
 * Separate from `shared/nav.ts` on purpose, for three reasons in order of
 * weight:
 *
 * 1. `featureForPath` there is consulted by `RequireFeature` for EVERY in-app
 *    path. One table serving two guards means one longest-prefix search
 *    deciding both, and Ticket List's `match: ["/tickets/"]` prefix is exactly
 *    the kind of rule that shadows a sibling. Two tables, two guards, neither
 *    can leak into the other.
 * 2. That table is grouped for a fourteen-item rail. This has a handful of
 *    items and no groups.
 * 3. **`feature` is REQUIRED here.** `useFeatureAccess().has(undefined)` returns
 *    TRUE, so an optional key silently means "visible to every signed-in user"
 *    — which is how the ops rail ended up showing Dashboard, the Escalation
 *    Queue and AI Review to anyone at all.
 */
export interface PortalNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  match?: string[];
  /** Required — see the note above. There is no ungated portal SCREEN. */
  feature: string;
}

/**
 * Intake channels that have a portal screen TODAY.
 *
 * A map, not a boolean, because this is what `intakeChannels` decides. `Excel`
 * is deliberately absent: the bulk importer has no backend, so a vendor given
 * that channel simply sees no extra entry screen. Add it here the day the real
 * importer lands and the nav item appears on its own. `API` has no screen by
 * definition — it is somebody else's application calling ours.
 */
const CHANNEL_ENTRY: Partial<Record<IntakeChannel, PortalNavItem>> = {
  Manual: {
    label: "Raise a ticket",
    to: "/portal/tickets/new",
    icon: FileText,
    feature: "jobs.create",
  },
};

const ALWAYS: PortalNavItem[] = [
  {
    label: "My products",
    to: "/portal/products",
    icon: Package,
    // In ALWAYS rather than CHANNEL_ENTRY: adding a product is not an intake
    // channel, and a vendor whose tickets arrive by Excel still has a
    // catalogue.
    //
    // Gated on `vendor.catalogue`, which is seeded to `vendor` and not to
    // `vendor_user` — the line `vendor.users` already draws. A sub-user raises
    // tickets; shaping the book is a vendor-admin act. One Feature Access row
    // widens it per company, with no deploy.
    feature: "vendor.catalogue",
  },
  {
    label: "My brands",
    to: "/portal/brands",
    icon: Tags,
    // The same key as My products: a brand is part of the book, and a
    // sub-user who only raises tickets has no brand to ask for.
    feature: "vendor.catalogue",
  },
  {
    label: "My tickets",
    to: "/portal/tickets",
    icon: ListFilter,
    match: ["/portal/tickets/"],
    feature: "jobs.view",
  },
  { label: "Users", to: "/portal/users", icon: UserCog, feature: "vendor.users" },
];

/** What THIS vendor sees, entry screens first. */
export function portalNav(channels: IntakeChannel[]): PortalNavItem[] {
  const entries = channels
    .map((c) => CHANNEL_ENTRY[c])
    .filter((i): i is PortalNavItem => i !== undefined);
  return [...entries, ...ALWAYS];
}

/**
 * Every path the portal knows — channel-independent, because the GUARD must
 * recognise a path even when this vendor's channels do not light it up. A
 * vendor without `Manual` should be redirected away from `/portal/tickets/new`,
 * not handed it because the table had never heard of it.
 */
const ALL_ITEMS: PortalNavItem[] = [...Object.values(CHANNEL_ENTRY), ...ALWAYS];

/**
 * Paths any signed-in portal user reaches whatever their features: their own
 * record, their own password and their own bell.
 *
 * The feed is ungated rather than given a key of its own because its audience
 * is decided in SQL — the API returns only notifications carrying this vendor's
 * `vendor_id`. A feature key here would be a second, weaker copy of a rule the
 * server already enforces, and `PortalNavItem.feature` being required leaves no
 * third option. Without this line the route exists and is unreachable: the
 * guard denies anything the nav table does not name.
 *
 * An explicit allow-list, because `RequirePortalFeature` DENIES anything it
 * does not recognise — the opposite polarity to the ops guard, and the reason
 * `has(undefined)` cannot leak here.
 */
export const PORTAL_UNGATED = new Set([
  "/portal",
  "/portal/account",
  "/portal/notifications",
  "/portal/password",
]);

/** `undefined` means "not a portal screen", which the guard reads as deny. */
export function featureForPortalPath(pathname: string): string | undefined {
  return longestMatch(ALL_ITEMS, pathname)?.feature;
}

/**
 * Which rail entry is lit, by the same longest-prefix rule the guard uses.
 *
 * It has to be longest-prefix and not `NavLink`'s own matching, because two
 * entries overlap: "My tickets" is `/portal/tickets` and claims the prefix
 * `/portal/tickets/`, which "Raise a ticket" at `/portal/tickets/new` sits
 * inside. Plain prefix matching lights both; `end` on My tickets lights
 * neither on a ticket detail page. Longest wins gets all three right.
 */
export function activePortalPath(
  items: PortalNavItem[],
  pathname: string
): string | undefined {
  return longestMatch(items, pathname)?.to;
}

function longestMatch(
  items: PortalNavItem[],
  pathname: string
): PortalNavItem | undefined {
  const exact = items.find((i) => i.to === pathname);
  if (exact) return exact;
  return items
    .filter(
      (i) =>
        pathname.startsWith(`${i.to}/`) ||
        i.match?.some((m) => pathname.startsWith(m))
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
}
