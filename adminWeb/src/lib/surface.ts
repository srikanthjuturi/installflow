/**
 * The surfaces and workspaces of the console, in one pure module.
 *
 * **Surface** — which shell a signed-in session belongs in: the superadmin
 * console, the franchise portal, the vendor portal or the staff console. The
 * ranking below is the same one `landingPath` has always owned (store/session)
 * and it is asked exactly there; every other consumer goes through
 * `SHELL_PATHS[surface]` so the four shells cannot drift apart on where their
 * bell, account page and password form live.
 *
 * A component that only needs to know "am I in a portal?" reads
 * `surface === "ops"` — the property the staff screens rely on is that the
 * default is the staff surface, and nothing the staff shell renders can see
 * anything else.
 *
 * **Workspace** — which set of backends the reused money screens call. The
 * staff technician list, redemption queue and penalty pool are the franchise
 * portal's too: same components, different endpoint twins, different link
 * targets, different feature keys. Those three differences live in the two
 * records below (`services/workspace.ts` wraps them with the actual API
 * functions). See Task 09 §5.2 — the alternative was forking seven pages or
 * threading a boolean through four levels of props, both rejected there.
 */

export type Surface = "superadmin" | "franchise" | "vendor" | "ops";

/**
 * Which surface this session is on. Order matters and is pinned by
 * `store/session.test.ts`:
 *
 *   superadmin → franchise → vendor → ops
 *
 * A superadmin has a company attached (`memberships` survive a superadmin's
 * company record) but holds no surface of their own, so their flag is asked
 * first. The three workspace flags are mutually exclusive in practice —
 * `signInBackend` derives them from one role — but the order is the contract,
 * not the exclusivity: never reorder by call site.
 */
export function surfaceOf(s: {
  superadmin: boolean;
  franchise: boolean;
  portal: boolean;
}): Surface {
  if (s.superadmin) return "superadmin";
  if (s.franchise) return "franchise";
  if (s.portal) return "vendor";
  return "ops";
}

/**
 * The four paths each shell owns for itself: its home, its bell, its account
 * page and its password form. `NotificationBell`, `AccountPage` and
 * `ChangePasswordPage` are each mounted on more than one surface, so their
 * links come from here instead of `portal ? "/portal/…" : "/…"` ternaries —
 * one table, four shells, no sixth surface silently forgotten.
 */
export const SHELL_PATHS: Record<
  Surface,
  { home: string; notifications: string; account: string; password: string }
> = {
  superadmin: {
    home: "/companies",
    notifications: "/notifications",
    account: "/account",
    password: "/account/password",
  },
  franchise: {
    home: "/franchise",
    notifications: "/franchise/notifications",
    account: "/franchise/account",
    password: "/franchise/password",
  },
  vendor: {
    home: "/portal",
    notifications: "/portal/notifications",
    account: "/portal/account",
    password: "/portal/password",
  },
  ops: {
    home: "/",
    notifications: "/notifications",
    account: "/account",
    password: "/account/password",
  },
};

/* --------------------------------------------------------------- workspace */

/**
 * The two workspaces the reused money screens run in. `ops` is the staff
 * console (the default); `franchise` is the portal, pointed at the
 * `/franchise/*` twins.
 */
export type Workspace = "ops" | "franchise";

/** Where a reused screen links, per workspace. */
export interface WorkspacePaths {
  /** The roster: `/technicians` | `/franchise/technicians`. */
  technicians: string;
  technician(id: string): string;
  /** A technician's job history: `/technicians/:id/tickets` | the franchise twin. */
  technicianTickets(id: string): string;
  tickets: string;
  ticket(id: string): string;
  redemptions: string;
  redemption(id: string): string;
}

export const WORKSPACE_PATHS: Record<Workspace, WorkspacePaths> = {
  ops: {
    technicians: "/technicians",
    technician: (id) => `/technicians/${id}`,
    technicianTickets: (id) => `/technicians/${id}/tickets`,
    tickets: "/tickets",
    ticket: (id) => `/tickets/${id}`,
    redemptions: "/redemptions",
    redemption: (id) => `/redemptions/${id}`,
  },
  franchise: {
    technicians: "/franchise/technicians",
    technician: (id) => `/franchise/technicians/${id}`,
    technicianTickets: (id) => `/franchise/technicians/${id}/tickets`,
    tickets: "/franchise/tickets",
    ticket: (id) => `/franchise/tickets/${id}`,
    redemptions: "/franchise/redemptions",
    redemption: (id) => `/franchise/redemptions/${id}`,
  },
};

/**
 * The feature keys a reused screen gates its buttons on, per workspace.
 *
 * The staff keys come from the nav table's own wiring (`technicians.*`, the
 * redemptions route's `redemptions.pay`, the ledger route's `earnings.view`).
 * The franchise keys are the portal's own family — the roster's reads AND
 * writes are one key (`franchise.technicians`), while the money decisions ride
 * `franchise.payouts` and the pool rides `franchise.pool`. The one asymmetry
 * the portal inherits from §4.3: the pool screen holds the Reverse button (the
 * ticket page is read-only there), while the staff pool holds none — the
 * ticket page keeps it, so ops' `reversePoolPenalty` is `null` and the staff
 * `LedgerPage` never grows a column from it.
 */
export interface WorkspaceFeatures {
  createTechnician: string;
  inviteTechnician: string;
  editTechnician: string;
  /** Deciding a UPI change. The staff side rides the edit key; the portal has its own. */
  decideUpi: string;
  payRedemptions: string;
  viewPool: string;
  /** Reverse a pool penalty from the POOL screen. Null on ops: staff reverse on the ticket page. */
  reversePoolPenalty: string | null;
}

export const WORKSPACE_FEATURES: Record<Workspace, WorkspaceFeatures> = {
  ops: {
    createTechnician: "technicians.create",
    inviteTechnician: "technicians.invite",
    editTechnician: "technicians.edit",
    decideUpi: "technicians.edit",
    payRedemptions: "redemptions.pay",
    viewPool: "earnings.view",
    reversePoolPenalty: null,
  },
  franchise: {
    createTechnician: "franchise.technicians",
    inviteTechnician: "franchise.technicians",
    editTechnician: "franchise.technicians",
    decideUpi: "franchise.payouts",
    payRedemptions: "franchise.payouts",
    viewPool: "franchise.pool",
    reversePoolPenalty: "franchise.pool",
  },
};