/**
 * Where a notification's stored route lands, per surface — extracted from
 * `NotificationList.tsx` (Task 09), which was the only caller and now passes
 * `surfaceOf(session)`.
 *
 * The server stores ONE route per notification. Most are written for the
 * staff console; the vendor portal and the franchise portal are separate route
 * trees over the same records, so the same row has to point somewhere else
 * there.
 *
 * Rewritten here rather than stored twice: two columns would have to be kept
 * in step by every writer, and a notification whose two routes disagreed would
 * be worse than one that needed translating.
 */

import type { Surface } from "@/lib/surface";

type Rewrite = [prefix: string, rewrite: (path: string) => string];

/**
 * Where each route lands for a PORTAL reader, first match wins.
 *
 * An ordered table rather than a chain of ifs, because the list grows:
 * `vendor_id` widens a notification to a vendor's portal, and six kinds
 * already carry one.
 */
const PORTAL_ROUTES: Rewrite[] = [
  ["/tickets/", (path) => `/portal${path}`],
  // A staff-written route for something a vendor is a party to. `/approvals`
  // is the ops queue; their copy of that product is on their own screen.
  ["/approvals", () => "/portal/products"],
  ["/portal/products", (path) => path],
  // A decision on a brand they added.
  ["/portal/brands", (path) => path],
];

/**
 * The same table in the other direction, for a STAFF reader.
 *
 * It is needed because `vendor_id` on a notification WIDENS the audience and
 * never narrows it: a product decision is written for the vendor and lands in
 * every staff feed too. Without this, a manager clicking one would be sent to
 * `/portal/products`, which `RequirePortal` bounces straight back to `/` — a
 * bell that leads nowhere, which is the one thing a notification must not be.
 */
const OPS_ROUTES: Rewrite[] = [
  ["/portal/products", () => "/approvals"],
  // The Brands half of the same queue.
  ["/portal/brands", () => "/approvals?kind=brands"],
];

/**
 * The third table (§5.4) — for the FRANCHISE reader. The kinds a franchisee
 * admin receives after Task 05 are stored staff-style: a UPI change points at
 * `/technicians/{id}`, a redemption at `/redemptions/{id}`, Task 05's
 * `technician_moved` at the LIST (`/technicians`). All three prefixes rewrite
 * to the portal's twins; every OTHER stored route — an ops queue their role
 * does not hold, like `/approvals`, or a kind this build has never heard of —
 * lands on the portal home, which is the one place that always exists. A staff
 * console route that 403s is a bell that leads nowhere.
 */
const FRANCHISE_ROUTES: Rewrite[] = [
  ["/tickets/", (path) => `/franchise${path}`],
  // The list AND the profiles: one prefix does both, the same way the staff
  // table's rules are by prefix rather than by shape.
  ["/technicians", (path) => `/franchise${path}`],
  ["/redemptions", (path) => `/franchise${path}`],
];

/**
 * The query string is split off BEFORE matching. The old single rule only
 * handled `/tickets/…` correctly by luck — it prefixed the whole string, so a
 * `?focus=` would have travelled along by accident rather than by design.
 *
 * The fallback stays and is deliberate: a kind this build has never heard of
 * must still land somewhere real, the same reasoning `kindMeta` uses — a
 * portal reader's home, a franchisee's home, and for a staff reader whatever
 * the server wrote, because the ops routes ARE the ones it writes by default.
 */
export function routeFor(to: string, surface: Surface): string {
  const q = to.indexOf("?");
  const path = q === -1 ? to : to.slice(0, q);
  const query = q === -1 ? "" : to.slice(q);
  const table =
    surface === "franchise"
      ? FRANCHISE_ROUTES
      : surface === "vendor"
        ? PORTAL_ROUTES
        : OPS_ROUTES;
  const hit = table.find(([prefix]) => path.startsWith(prefix));
  if (hit) return `${hit[1](path)}${query}`;
  return surface === "vendor"
    ? "/portal/tickets"
    : surface === "franchise"
      ? "/franchise"
      : to;
}