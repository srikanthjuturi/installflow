import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  API_ROLE,
  type ApiRole,
  type AuthPayload,
  type AuthUser,
} from "@/types/api";
import type { Role } from "@/types";

/* ------------------------------------------------------------- role mapping */

/**
 * The wire carries a **number**; every screen in this console speaks the
 * `Role` union. These two helpers are the only place the two vocabularies
 * meet, so a corrected code table is a one-file change.
 *
 * All five codes are confirmed against the backend: ADMIN 1, NH 2, RSH 3,
 * ASM 4, Ops Staff 5. The mapping is 1:1 in both directions, so a role can be
 * read from the wire and written back without drifting.
 *
 * An unrecognised code still falls through to the least-privileged label
 * rather than guessing upward: showing someone less scope than they have is
 * recoverable, the reverse is not. RBAC is enforced server-side (AGENTS.md
 * hard rule 8), so this label informs a human — it never grants anything.
 */
export const LEAST_PRIVILEGED_ROLE: Role = "Ops Staff";

export function roleFromApi(code: number): Role {
  switch (code) {
    case API_ROLE.ADMIN:
      return "Admin";
    case API_ROLE.NH:
      return "NH";
    case API_ROLE.RSH:
      return "RSH";
    case API_ROLE.ASM:
      return "ASM";
    case API_ROLE.OPS_STAFF:
      return "Ops Staff";
    default:
      return LEAST_PRIVILEGED_ROLE;
  }
}

/** The reverse. A true round trip: `apiRoleOf(roleFromApi(n)) === n`. */
export function apiRoleOf(role: Role): ApiRole {
  switch (role) {
    case "Admin":
      return API_ROLE.ADMIN;
    case "NH":
      return API_ROLE.NH;
    case "RSH":
      return API_ROLE.RSH;
    case "ASM":
      return API_ROLE.ASM;
    case "Ops Staff":
      return API_ROLE.OPS_STAFF;
  }
}

/* ------------------------------------------------------------------- store */

/** The scope the console opens on before anyone signs in. */
const DEFAULT_VIEW_ROLE: Role = "ASM";

/**
 * Client state only. Tickets, technicians, escalations and the ledger are
 * server state and live in TanStack Query — never here.
 */
interface SessionState {
  signedIn: boolean;
  /**
   * Bearer token from `AuthPayload`. Persisted so a reload keeps the session.
   *
   * ⚠ Persisted means `localStorage`, which any injected script can read. A
   * refresh token in an httpOnly cookie is the safer shape once the backend
   * offers one. It is never put in a URL, logged, or rendered.
   */
  accessToken: string | null;
  /** The signed-in account exactly as the API returned it. */
  user: AuthUser | null;
  /**
   * Flattened mirrors of `user`, written only by `signIn` / `signOut`. The
   * shared chrome (sidebar, account link) reads these directly.
   */
  name: string;
  email: string;
  /** The scope being viewed. Server-side guards are the real authority;
   *  this only drives presentation. */
  role: Role;
  /** Mobile drawer — transient, never persisted. */
  sidebarOpen: boolean;
  /** Desktop rail collapsed to icons. Persisted: it is a workspace preference,
   *  and having it reset on every reload would be worse than not having it. */
  sidebarCollapsed: boolean;
  signIn: (payload: AuthPayload) => void;
  signOut: () => void;
  setRole: (role: Role) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      signedIn: false,
      accessToken: null,
      user: null,
      name: "",
      email: "",
      role: DEFAULT_VIEW_ROLE,
      sidebarOpen: false,
      sidebarCollapsed: false,
      // The whole identity arrives in one payload, so it is stored in one
      // write — there is no moment where a token exists without its user.
      signIn: ({ accessToken, user }) =>
        set({
          signedIn: true,
          accessToken,
          user,
          name: user.name,
          email: user.email,
          role: roleFromApi(user.role),
        }),
      signOut: () =>
        set({
          signedIn: false,
          accessToken: null,
          user: null,
          name: "",
          email: "",
          role: DEFAULT_VIEW_ROLE,
        }),
      setRole: (role) => set({ role }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "installflow.session",
      version: 2,
      // v1 persisted a hardcoded name and email and no token at all. There is
      // no token to recover from it, so a v1 session cannot be honoured —
      // keep the workspace preference and make the user sign in again.
      migrate: (persisted) =>
        ({
          ...(persisted as Partial<SessionState>),
          signedIn: false,
          accessToken: null,
          user: null,
          name: "",
          email: "",
        }) as SessionState,
      partialize: (s) => ({
        signedIn: s.signedIn,
        accessToken: s.accessToken,
        user: s.user,
        email: s.email,
        name: s.name,
        role: s.role,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
);

export const ROLE_LABEL: Record<Role, string> = {
  Admin: "Administrator",
  NH: "National Head",
  RSH: "Regional Service Head · West",
  ASM: "Area Service Manager · Pune",
  "Ops Staff": "Ops Staff · Pune",
};
