import { describe, expect, it } from "vitest";
import {
  SHELL_PATHS,
  WORKSPACE_FEATURES,
  WORKSPACE_PATHS,
  surfaceOf,
} from "./surface";

/**
 * Task 09 §6 — the surfaces and workspaces rank in one place, so these pin the
 * ranking and the two per-workspace records the reused screens read.
 */
describe("surfaceOf", () => {
  it("ranks superadmin above every workspace flag", () => {
    expect(surfaceOf({ superadmin: true, franchise: true, portal: true })).toBe(
      "superadmin"
    );
    expect(surfaceOf({ superadmin: true, franchise: true, portal: false })).toBe(
      "superadmin"
    );
    expect(
      surfaceOf({ superadmin: true, franchise: false, portal: true })
    ).toBe("superadmin");
    expect(
      surfaceOf({ superadmin: true, franchise: false, portal: false })
    ).toBe("superadmin");
  });

  it("ranks franchise over portal", () => {
    expect(surfaceOf({ superadmin: false, franchise: true, portal: true })).toBe(
      "franchise"
    );
  });

  it("sends a portal session to the vendor portal", () => {
    expect(
      surfaceOf({ superadmin: false, franchise: false, portal: true })
    ).toBe("vendor");
  });

  it("is the staff console when no workspace flag is set", () => {
    expect(
      surfaceOf({ superadmin: false, franchise: false, portal: false })
    ).toBe("ops");
  });
});

describe("SHELL_PATHS", () => {
  it("names each surface's home — the four shells cannot drift apart", () => {
    expect(SHELL_PATHS.superadmin.home).toBe("/companies");
    expect(SHELL_PATHS.franchise.home).toBe("/franchise");
    expect(SHELL_PATHS.vendor.home).toBe("/portal");
    expect(SHELL_PATHS.ops.home).toBe("/");
  });
});

describe("WORKSPACE_PATHS", () => {
  it("points reused screens at the portal twins, /franchise-prefixed", () => {
    expect(WORKSPACE_PATHS.franchise.technician("a")).toBe(
      "/franchise/technicians/a"
    );
    expect(WORKSPACE_PATHS.franchise.ticket("t")).toBe(
      "/franchise/tickets/t"
    );
  });

  it("keeps the ops twins unprefixed — staff routes are a regression risk", () => {
    expect(WORKSPACE_PATHS.ops.technician("a")).toBe("/technicians/a");
    expect(WORKSPACE_PATHS.ops.ticket("t")).toBe("/tickets/t");
  });
});

describe("WORKSPACE_FEATURES", () => {
  it("gates the portal's UPI decision on its own payouts key", () => {
    expect(WORKSPACE_FEATURES.franchise.decideUpi).toBe("franchise.payouts");
  });

  it("carries NO reverse action on the staff pool — staff reverse on the ticket page", () => {
    expect(WORKSPACE_FEATURES.ops.reversePoolPenalty).toBeNull();
  });
});