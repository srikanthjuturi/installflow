import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  API_ROLE,
  PORTAL_ROLES,
  type ApiRole,
  type AuthPayload,
  type AuthUser,
  type BackendMembership,
  type BackendRole,
  type BackendUser,
  type LoginResponse,
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

/**
 * Map the live backend's string role to the console's display `Role`. Superadmin
 * has no ops-console equivalent — it renders its own shell — so the chrome role
 * is never actually read for one; it falls back to the least-privileged label.
 */
export function roleFromBackend(role: BackendRole): Role {
  switch (role) {
    case "admin":
      return "Admin";
    case "national_head":
      return "NH";
    case "regional_head":
      return "RSH";
    case "area_manager":
      return "ASM";
    case "technician":
      return "Ops Staff";
    default:
      return LEAST_PRIVILEGED_ROLE;
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
   * ⚠ Persisted means `localStorage`, which any injected script can read. An
   * httpOnly cookie is the safer shape, but the backend returns both tokens in
   * the response body, so moving them there is an API change, not a client
   * one. Neither is ever put in a URL, logged, or rendered.
   */
  accessToken: string | null;
  /**
   * Long-lived token that buys a new access token when the 30-minute one
   * expires — see `services/http.ts`, which is the only consumer. The backend
   * rotates on every use, so this value changes as the session runs and is
   * persisted alongside the access token.
   */
  refreshToken: string | null;
  /** The signed-in account exactly as the API returned it. */
  user: AuthUser | null;
  /**
   * Real-backend identity (live FastAPI auth). Set by `signInBackend`; the
   * superadmin companies module reads these. Kept separate from the mock `user`
   * above so the still-mocked ops-console screens keep compiling untouched.
   */
  superadmin: boolean;
  /**
   * This session belongs in the vendor portal, not the ops console.
   *
   * A stored flag rather than a role comparison at each call site: five places
   * have to agree on where a session lives — two route guards, the login
   * redirect, the catch-all and the shell — and one of them reading
   * `backendUser?.role` directly is how they stop agreeing.
   */
  portal: boolean;
  backendUser: BackendUser | null;
  memberships: BackendMembership[];
  /** The company the token is currently scoped to (the header switcher's value). */
  activeCompanyId: string | null;
  /**
   * Flattened mirrors of `user`, written only by `signIn` / `signOut`. The
   * shared chrome (sidebar, account link) reads these directly.
   */
  name: string;
  email: string;
  /**
   * The signed-in user's avatar URL, or `null` for the initials fallback.
   *
   * A cached MIRROR of `backendUser.profileImageUrl`, not the source: sign-in
   * seeds it and `PATCH /auth/me` updates it. It exists so the rail can draw
   * the avatar without holding a query subscription, and it is persisted so a
   * reload draws it before `me` returns.
   */
  avatarUrl: string | null;
  /** The scope being viewed. Server-side guards are the real authority;
   *  this only drives presentation. */
  role: Role;
  /** Mobile drawer — transient, never persisted. */
  sidebarOpen: boolean;
  /** Desktop rail collapsed to icons. Persisted: it is a workspace preference,
   *  and having it reset on every reload would be worse than not having it. */
  sidebarCollapsed: boolean;
  signIn: (payload: AuthPayload) => void;
  /** Sign in from the live backend's login payload (the superadmin path). */
  signInBackend: (payload: LoginResponse) => void;
  /**
   * Store a rotated token pair. Called by the transport after a successful
   * refresh — the identity is unchanged, so nothing else is touched.
   */
  setTokens: (next: { accessToken: string; refreshToken: string }) => void;
  /** Apply a re-scoped token after switching companies. */
  setActiveCompany: (next: {
    accessToken: string;
    activeCompanyId: string;
  }) => void;
  signOut: () => void;
  /** Set or clear the avatar. `null` restores the initials fallback. */
  setAvatar: (avatarUrl: string | null) => void;
  setRole: (role: Role) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      signedIn: false,
      accessToken: null,
      refreshToken: null,
      user: null,
      superadmin: false,
      portal: false,
      backendUser: null,
      memberships: [],
      activeCompanyId: null,
      name: "",
      email: "",
      avatarUrl: null,
      role: DEFAULT_VIEW_ROLE,
      sidebarOpen: false,
      sidebarCollapsed: false,
      // The whole identity arrives in one payload, so it is stored in one
      // write — there is no moment where a token exists without its user.
      signIn: ({ accessToken, user }) =>
        set({
          signedIn: true,
          accessToken,
          // The mock sign-in issues no refresh token; make that explicit so a
          // previous backend session's token can never be left behind.
          refreshToken: null,
          user,
          name: user.name,
          email: user.email,
          role: roleFromApi(user.role),
        }),
      signInBackend: ({
        accessToken,
        refreshToken,
        user,
        memberships,
        activeCompanyId,
      }) =>
        set({
          signedIn: true,
          accessToken,
          refreshToken,
          superadmin: user.isSuperadmin,
          portal: (PORTAL_ROLES as readonly string[]).includes(user.role),
          backendUser: user,
          memberships,
          activeCompanyId,
          name: user.fullName ?? user.email,
          email: user.email,
          // Seeded from the server, so the photo follows the account to any
          // browser rather than living only where it was cropped.
          avatarUrl: user.profileImageUrl,
          role: roleFromBackend(user.role),
        }),
      setTokens: ({ accessToken, refreshToken }) =>
        set({ accessToken, refreshToken }),
      // Switching company re-scopes the access token only — the backend does
      // not rotate the refresh token here, so it is deliberately left alone.
      setActiveCompany: ({ accessToken, activeCompanyId }) =>
        set({ accessToken, activeCompanyId }),
      signOut: () =>
        set({
          signedIn: false,
          accessToken: null,
          refreshToken: null,
          user: null,
          superadmin: false,
          portal: false,
          backendUser: null,
          memberships: [],
          activeCompanyId: null,
          name: "",
          email: "",
          avatarUrl: null,
          role: DEFAULT_VIEW_ROLE,
        }),
      setAvatar: (avatarUrl) => set({ avatarUrl }),
      setRole: (role) => set({ role }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "reliancegreentech.session",
      version: 6,
      // Older sessions predate the live backend (or carry a stale view-role
      // from the removed role toggle, lack activeCompanyId, or — before v5 —
      // hold an access token with no refresh token to renew it). Before v6 they
      // also predate the vendor portal, so they cannot say which shell they
      // belong in — and that flag decides routing. None can be trusted — keep
      // the workspace preference and re-sign-in against the backend, which
      // re-derives role, active company and surface from scratch.
      migrate: (persisted) =>
        ({
          ...(persisted as Partial<SessionState>),
          signedIn: false,
          accessToken: null,
          refreshToken: null,
          user: null,
          superadmin: false,
          portal: false,
          backendUser: null,
          memberships: [],
          activeCompanyId: null,
          name: "",
          email: "",
          avatarUrl: null,
        }) as SessionState,
      partialize: (s) => ({
        signedIn: s.signedIn,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
        superadmin: s.superadmin,
        portal: s.portal,
        backendUser: s.backendUser,
        memberships: s.memberships,
        activeCompanyId: s.activeCompanyId,
        email: s.email,
        name: s.name,
        avatarUrl: s.avatarUrl,
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

/**
 * Where a session lives.
 *
 * The ONE place the three surfaces are ranked, so the two route guards, the
 * login redirect and the catch-all cannot drift apart. Order matters:
 * superadmin has no company and therefore no portal, so it is asked first.
 */
export function landingPath(s: {
  superadmin: boolean;
  portal: boolean;
}): string {
  if (s.superadmin) return "/companies";
  if (s.portal) return "/portal";
  return "/";
}
