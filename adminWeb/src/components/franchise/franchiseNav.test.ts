import { describe, expect, it } from "vitest";
import {
  FRANCHISE_NAV,
  FRANCHISE_UNGATED,
  featureForFranchisePath,
  franchiseLanding,
  franchiseNav,
} from "./franchiseNav";

/**
 * Task 09 §6 — the portal's ONE table feeds both the guard
 * (`RequireFranchiseFeature`) and the rail, so these pin the guard's answers,
 * the rail's filtering and the landing rule.
 */
describe("featureForFranchisePath", () => {
  it("gates a technician's profile on the roster key", () => {
    expect(featureForFranchisePath("/franchise/technicians/x/tickets")).toBe(
      "franchise.technicians"
    );
  });

  it("gates a redemption detail on the payouts key", () => {
    expect(featureForFranchisePath("/franchise/redemptions/r")).toBe(
      "franchise.payouts"
    );
  });

  it("denies a path the portal has never heard of", () => {
    expect(featureForFranchisePath("/franchise/unknown")).toBeUndefined();
    // The staff console's franchisees screen is NOT a portal screen.
    expect(featureForFranchisePath("/franchisees")).toBeUndefined();
  });
});

describe("franchiseNav", () => {
  const never = () => false;

  it("keeps only Tickets for a facility feature set", () => {
    const items = franchiseNav((key) => key === "franchise.tickets");
    expect(items.map((i) => i.label)).toEqual(["Tickets"]);
  });

  it("keeps nothing for somebody with no keys at all", () => {
    expect(franchiseNav(never)).toEqual([]);
  });
});

describe("franchiseLanding", () => {
  it("lands a full franchisee admin on Technicians (the rail's first entry)", () => {
    const has = (key?: string) =>
      !!key && FRANCHISE_NAV.map((i) => i.feature).includes(key);
    expect(franchiseLanding(has)).toBe("/franchise/technicians");
  });

  it("lands a facility role on Tickets (their one entry)", () => {
    expect(franchiseLanding((key) => key === "franchise.tickets")).toBe(
      "/franchise/tickets"
    );
  });

  it("falls back to Account for an empty feature set — which is ungated, so no loop", () => {
    // The no-loop property: the fallback must be reachable by the guard.
    expect(FRANCHISE_UNGATED.has("/franchise/account")).toBe(true);
    expect(franchiseLanding(() => false)).toBe("/franchise/account");
  });
});

describe("FRANCHISE_NAV shape", () => {
  it("names a feature on EVERY item — an optional key is visible to everybody", () => {
    for (const item of FRANCHISE_NAV) {
      expect(item.feature.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});