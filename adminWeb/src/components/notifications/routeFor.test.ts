import { describe, expect, it } from "vitest";
import { routeFor } from "./routeFor";

/**
 * Task 09 §6 — the FRANCHISE table rewrites staff-written routes into the
 * portal's twins; the vendor and ops tables are pinned as regressions.
 */
describe("routeFor — franchise", () => {
  it("rewrites a ticket route and carries the query string", () => {
    expect(routeFor("/tickets/1?focus=x", "franchise")).toBe(
      "/franchise/tickets/1?focus=x"
    );
  });

  it("rewrites a technician profile AND the roster (one prefix does both)", () => {
    expect(routeFor("/technicians/2", "franchise")).toBe(
      "/franchise/technicians/2"
    );
    expect(routeFor("/technicians", "franchise")).toBe(
      "/franchise/technicians"
    );
  });

  it("rewrites a redemption route", () => {
    expect(routeFor("/redemptions/3", "franchise")).toBe(
      "/franchise/redemptions/3"
    );
  });

  it("falls back to the portal home for a route that is not the franchisee's", () => {
    // `/approvals` is the ops queue; a franchisee holds no copy of it.
    expect(routeFor("/approvals", "franchise")).toBe("/franchise");
  });
});

describe("routeFor — vendor (regression)", () => {
  it("keeps its own ticket and approvals rewrites", () => {
    expect(routeFor("/portal/products", "vendor")).toBe("/portal/products");
    expect(routeFor("/approvals", "vendor")).toBe("/portal/products");
  });
});

describe("routeFor — ops (regression)", () => {
  it("passes the server's own routes through untouched", () => {
    expect(routeFor("/tickets/1", "ops")).toBe("/tickets/1");
    // A vendor-addressed row lands in the ops queue it belongs to.
    expect(routeFor("/portal/products", "ops")).toBe("/approvals");
  });
});