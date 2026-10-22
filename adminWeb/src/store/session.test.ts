import { beforeEach, describe, expect, it } from "vitest";
import { useSession } from "./session";
import { landingPath } from "./session";
import type { LoginResponse } from "@/types/api";

/**
 * Task 09 §6 — the third shell's routing facts. `landingPath` ranks the three
 * flags (the table is `surfaceOf`, pinned in `lib/surface.test.ts`; here it is
 * the call sites' question, "where do I send this session now"), and the v6→v7
 * `migrate` decides whether a session persisted before this deploy survives it.
 */

/** Three flags, eight combinations, ranked superadmin → franchise → portal → ops. */
describe("landingPath", () => {
  it("sends every superadmin shape to the companies screen", () => {
    expect(
      landingPath({ superadmin: true, franchise: true, portal: true })
    ).toBe("/companies");
    expect(
      landingPath({ superadmin: true, franchise: true, portal: false })
    ).toBe("/companies");
    expect(
      landingPath({ superadmin: true, franchise: false, portal: true })
    ).toBe("/companies");
    expect(
      landingPath({ superadmin: true, franchise: false, portal: false })
    ).toBe("/companies");
  });

  it("sends a franchise session to the portal home, above a portal role", () => {
    expect(landingPath({ superadmin: false, franchise: true, portal: true })).toBe(
      "/franchise"
    );
    expect(landingPath({ superadmin: false, franchise: true, portal: false })).toBe(
      "/franchise"
    );
  });

  it("sends a vendor to the portal and a staff session to the console", () => {
    expect(landingPath({ superadmin: false, franchise: false, portal: true })).toBe(
      "/portal"
    );
    expect(landingPath({ superadmin: false, franchise: false, portal: false })).toBe(
      "/"
    );
  });
});

const STORAGE_KEY = "reliancegreentech.session";

function writeStored(version: number, state: Record<string, unknown>) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version, state })
  );
}

/** The persisted identity the v6 shape held — only `backendUser.role` matters. */
function v6State(role: string): Record<string, unknown> {
  return {
    signedIn: true,
    accessToken: "at-6",
    refreshToken: "rt-6",
    backendUser: {
      id: "u-1",
      email: "a@b.com",
      fullName: "A B",
      phone: null,
      role,
      roleLabel: role,
      profileImageUrl: null,
      isSuperadmin: false,
    },
    memberships: [],
    activeCompanyId: "c-1",
    name: "A B",
    email: "a@b.com",
    avatarUrl: null,
    role: "Admin",
    sidebarCollapsed: false,
    notificationSound: true,
  };
}

describe("persist migrate", () => {
  beforeEach(() => {
    localStorage.clear();
    // Start from a signed-out store so a migration's effects are visible.
    useSession.getState().signOut();
  });

  it("keeps a v6 session and derives the franchise flag from the role", () => {
    writeStored(6, v6State("franchisee_admin"));
    useSession.persist.rehydrate();
    const s = useSession.getState();
    expect(s.signedIn).toBe(true);
    expect(s.franchise).toBe(true);
    expect(s.portal).toBe(false);
    // The identity itself is untouched — v7 only names a surface v6 was silent about.
    expect(s.accessToken).toBe("at-6");
    expect(s.activeCompanyId).toBe("c-1");
  });

  it("keeps a v6 staff session signed in, franchise false", () => {
    writeStored(6, v6State("admin"));
    useSession.persist.rehydrate();
    const s = useSession.getState();
    expect(s.signedIn).toBe(true);
    expect(s.franchise).toBe(false);
  });

  it("resets anything older than v6 — it predates the backend", () => {
    writeStored(5, v6State("admin"));
    useSession.persist.rehydrate();
    const s = useSession.getState();
    expect(s.signedIn).toBe(false);
    expect(s.accessToken).toBeNull();
    expect(s.franchise).toBe(false);
    expect(s.backendUser).toBeNull();
  });
});

function backendPayload(role: string): LoginResponse {
  return {
    user: {
      id: "u-1",
      email: "fr@nchise.com",
      fullName: "Franchise Admin",
      phone: null,
      role: role as LoginResponse["user"]["role"],
      roleLabel: role,
      profileImageUrl: null,
      isSuperadmin: false,
    },
    memberships: [],
    activeCompanyId: "c-1",
    accessToken: "at",
    refreshToken: "rt",
    tokenType: "bearer",
  };
}

describe("signInBackend surface flags", () => {
  beforeEach(() => {
    useSession.getState().signOut();
  });

  it.each(["franchisee_admin", "facility_admin", "facility_operator"] as const)(
    "flags %s as the franchise portal, never the vendor portal",
    (role) => {
      useSession.getState().signInBackend(backendPayload(role));
      const s = useSession.getState();
      expect(s.franchise).toBe(true);
      expect(s.portal).toBe(false);
      expect(s.superadmin).toBe(false);
    }
  );

  it("flags a staff role as the ops console", () => {
    useSession.getState().signInBackend(backendPayload("admin"));
    const s = useSession.getState();
    expect(s.franchise).toBe(false);
    expect(s.portal).toBe(false);
    expect(s.superadmin).toBe(false);
  });
});