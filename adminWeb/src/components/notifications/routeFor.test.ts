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

  it("keeps a part request's stored portal route (Task 13, acceptance 33)", () => {
    // Task 12 writes `/franchise/parts/requests/{id}` — already a portal route.
    expect(routeFor("/franchise/parts/requests/9", "franchise")).toBe(
      "/franchise/parts/requests/9"
    );
  });

  it("maps a bare /parts/ route onto the portal desk — one way only (R4)", () => {
    expect(routeFor("/parts/requests/9", "franchise")).toBe(
      "/franchise/parts/requests/9"
    );
    // No staff reader maps INTO a parts route: ops keeps the server's route.
    expect(routeFor("/parts/requests/9", "ops")).toBe("/parts/requests/9");
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