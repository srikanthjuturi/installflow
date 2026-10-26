/**
 * The franchise portal's page header table — the twin of
 * `shared/routeMeta.ts`, pure path → `{title, subtitle}` with no session.
 *
 * Its own file, because `shared/routeMeta.ts` serves `AppShell`'s topbar and
 * the table here must name nothing the staff rail offers (one wrong entry in
 * the shared map is one staff heading a franchisee admin can read).
 *
 * A token, like the staff table's `{escalationHours}`: `{franchisee}` is the
 * signed-in principal's franchisee name, which the shell substitutes from
 * `/auth/me` — this module cannot know it, and that is the point of the
 * indirection. Subtitles quoting it are §5.9's PROPOSED copy, unchanged.
 */
export const FRANCHISEE_NAME_TOKEN = "{franchisee}";

interface Meta {
  /** A plain string — every franchise route has a title of its own. */
  title: string;
  /** May contain `{franchisee}`, substituted by the shell before rendering. */
  subtitle: string;
}

const STATIC: Record<string, Meta> = {
  "/franchise/technicians": {
    title: "Technicians",
    subtitle: `${FRANCHISEE_NAME_TOKEN}'s technicians`,
  },
  "/franchise/upi-changes": {
    title: "UPI changes",
    subtitle: "Technicians asking to be paid somewhere new",
  },
  "/franchise/redemptions": {
    title: "Redemptions",
    subtitle: "Technician payouts by UPI",
  },
  "/franchise/pool": {
    title: "Penalty & bonus pool",
    subtitle: `${FRANCHISEE_NAME_TOKEN}'s pool`,
  },
  "/franchise/statements": {
    title: "Employee statements",
    subtitle: "A month's allowances and penalties, per employee",
  },
  "/franchise/settings": {
    title: "Allowance rules",
    subtitle: "Travel and speed allowances for your technicians",
  },
  "/franchise/parts": {
    title: "Spare parts",
    subtitle: "Part requests from technicians",
  },
  "/franchise/facility-users": {
    title: "Facility users",
    subtitle: "Who approves and logs spare parts",
  },
  "/franchise/tickets": {
    title: "Tickets",
    subtitle: `Tickets in ${FRANCHISEE_NAME_TOKEN}'s pincodes — read only`,
  },
  "/franchise/notifications": {
    title: "Notifications",
    subtitle: `Recent events for ${FRANCHISEE_NAME_TOKEN}`,
  },
  "/franchise/account": {
    title: "Account",
    subtitle: "Your profile & session",
  },
};

/** Longest-shape rules for the parameterised routes. */
const DYNAMIC: Array<[RegExp, Meta]> = [
  // The job history sits under the profile's prefix, so it is declared FIRST —
  // `/franchise/technicians/:id/tickets` would otherwise match the profile rule.
  [
    /^\/franchise\/technicians\/[^/]+\/tickets$/,
    { title: "Technician's tickets", subtitle: "Every job they have held" },
  ],
  [
    /^\/franchise\/technicians\/[^/]+$/,
    { title: "Technician profile", subtitle: "Category · pincode · bandwidth" },
  ],
  [
    /^\/franchise\/redemptions\/[^/]+$/,
    { title: "Redemption", subtitle: "Pay by UPI · record the proof" },
  ],
  // §5.10 names this page `{request code} · Spare part request`. The shell
  // resolves a heading from the PATH alone and cannot know the code, so the
  // topbar says what the page is and the code is the page's own first heading.
  [
    /^\/franchise\/parts\/requests\/[^/]+$/,
    { title: "Spare part request", subtitle: "" },
  ],
  [
    /^\/franchise\/tickets\/[^/]+$/,
    { title: "Ticket detail", subtitle: "Timeline & audit trail" },
  ],
];

export function FRANCHISE_ROUTE_META(pathname: string): Meta {
  if (STATIC[pathname]) return STATIC[pathname];
  for (const [re, meta] of DYNAMIC) if (re.test(pathname)) return meta;
  // Untitled fallback: the same shape AppShell renders when no entry matches,
  // with the brand doing the naming (FranchiseShell substitutes it).
  return { title: "", subtitle: "" };
}