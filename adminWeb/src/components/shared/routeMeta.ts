interface Meta {
  title: string;
  subtitle: string;
}

/** Exact copy from the approved prototype's page header. */
const STATIC: Record<string, Meta> = {
  "/": { title: "Dashboard", subtitle: "Operations overview" },
  "/tickets": { title: "Tickets", subtitle: "All installation & demo tickets" },
  "/escalations": {
    title: "Escalation queue",
    subtitle: "Unassigned within 4h of slot",
  },
  // Hidden with the route — see `nav.ts`.
  // "/ai-review": { title: "AI review queue", subtitle: "Flagged verifications" },
  "/technicians": { title: "Technicians", subtitle: "Technician master list" },
  "/ledger": { title: "Penalty & bonus pool", subtitle: "Financial ledger" },
  "/vendors": {
    title: "Vendors",
    subtitle: "The companies whose products you install",
  },
  "/territory": {
    title: "Territory mapping",
    subtitle: "Region → Regional Head → Area Manager → pincode",
  },
  "/categories": { title: "Categories & models", subtitle: "Product master" },
  // The prototype's subtitle read "SLA · penalty · AI · wait period". SLA
  // windows were a read-only card that has been removed, and the bonus bands
  // arrived from `BonusPicker` when the rules became a real per-company table.
  "/settings/rules": {
    title: "Rules configuration",
    subtitle: "Penalty · bonus · AI · timing",
  },
  "/settings/users": { title: "Users & roles", subtitle: "Access management" },
  /* Net-new — the prototype has no account or notifications screen. */
  "/notifications": {
    title: "Notifications",
    subtitle: "Recent operational events",
  },
  "/account": { title: "Account", subtitle: "Your profile & session" },
};

/** Longest-prefix rules for parameterised routes. */
const DYNAMIC: Array<[RegExp, Meta]> = [
  [
    /^\/tickets\/import\/[^/]+$/,
    { title: "Upload validation", subtitle: "Row-level result" },
  ],
  [
    /^\/tickets\/[^/]+\/force-close$/,
    { title: "Force closure", subtitle: "Justification required" },
  ],
  [
    /^\/tickets\/[^/]+\/assign$/,
    { title: "Manual assignment", subtitle: "Assign a technician" },
  ],
  // Both escalation actions are ticket-scoped now. `/escalations/:id/bonus`
  // and `/escalations/:id/assign` had entries here and no longer need them:
  // they are redirects, so the topbar reads the meta of wherever they land.
  [
    /^\/tickets\/[^/]+\/bonus$/,
    { title: "Bonus setup", subtitle: "Re-notification incentive" },
  ],
  [
    /^\/tickets\/[^/]+$/,
    { title: "Ticket detail", subtitle: "Timeline & audit trail" },
  ],
  // [
  //   /^\/ai-review\/[^/]+$/,
  //   { title: "AI review", subtitle: "Image & serial comparison" },
  // ],
  [
    /^\/technicians\/[^/]+$/,
    { title: "Technician profile", subtitle: "Category · pincode · bandwidth" },
  ],
];

export function PAGE_META(pathname: string): Meta {
  if (STATIC[pathname]) return STATIC[pathname];
  for (const [re, meta] of DYNAMIC) if (re.test(pathname)) return meta;
  return { title: "Reliance GreenTech", subtitle: "Ops Console" };
}
