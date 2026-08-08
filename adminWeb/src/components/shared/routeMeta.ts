interface Meta {
  title: string;
  subtitle: string;
}

/** Exact copy from the approved prototype's page header. */
const STATIC: Record<string, Meta> = {
  "/": { title: "Dashboard", subtitle: "Operations overview" },
  "/tickets": { title: "Tickets", subtitle: "All installation & demo tickets" },
  "/tickets/new": {
    title: "Manual ticket entry",
    subtitle: "Single ticket · ops entry",
  },
  "/tickets/import": {
    title: "Excel bulk upload",
    subtitle: "Template-based import",
  },
  "/escalations": {
    title: "Escalation queue",
    subtitle: "Unassigned within 4h of slot",
  },
  "/ai-review": { title: "AI review queue", subtitle: "Flagged verifications" },
  "/technicians": { title: "Technicians", subtitle: "Technician master list" },
  /* Net-new — service partners are not in the approved prototype. */
  "/partners/freelancers": {
    title: "Freelancers",
    subtitle: "Independent service partners",
  },
  "/partners/franchises": {
    title: "Franchises",
    subtitle: "Partner firms",
  },
  "/ledger": { title: "Penalty & bonus pool", subtitle: "Financial ledger" },
  "/vendors": { title: "Vendors", subtitle: "Master & API credentials" },
  "/territory": {
    title: "Territory mapping",
    subtitle: "Region → Regional Head → Area Manager → pincode",
  },
  "/categories": { title: "Categories & models", subtitle: "Product master" },
  "/settings/rules": {
    title: "Rules configuration",
    subtitle: "SLA · penalty · AI · wait period",
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
    /^\/tickets\/[^/]+$/,
    { title: "Ticket detail", subtitle: "Timeline & audit trail" },
  ],
  [
    /^\/escalations\/[^/]+\/bonus$/,
    { title: "Bonus setup", subtitle: "Re-notification incentive" },
  ],
  [
    /^\/escalations\/[^/]+\/assign$/,
    { title: "Manual assignment", subtitle: "Assign a technician" },
  ],
  [
    /^\/ai-review\/[^/]+$/,
    { title: "AI review", subtitle: "Image & serial comparison" },
  ],
  [
    /^\/technicians\/[^/]+$/,
    { title: "Technician profile", subtitle: "Category · pincode · bandwidth" },
  ],
];

export function PAGE_META(pathname: string): Meta {
  if (STATIC[pathname]) return STATIC[pathname];
  for (const [re, meta] of DYNAMIC) if (re.test(pathname)) return meta;
  return { title: "InstallFlow", subtitle: "Ops Console" };
}
