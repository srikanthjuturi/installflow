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

  it("gates the allowance rules on the settings key (Task 13)", () => {
    expect(featureForFranchisePath("/franchise/settings")).toBe(
      "franchise.settings"
    );
  });

  it("gates the parts desk and its request page on parts.handle (Task 13)", () => {
    expect(featureForFranchisePath("/franchise/parts")).toBe("parts.handle");
    // The request page rides the entry's match prefix.
    expect(featureForFranchisePath("/franchise/parts/requests/abc")).toBe(
      "parts.handle"
    );
  });

  it("gates facility users on franchise.facility_users (Task 13)", () => {
    expect(featureForFranchisePath("/franchise/facility-users")).toBe(
      "franchise.facility_users"
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

  it("lists Allowance rules after Employee statements, for the settings key only", () => {
    const labels = FRANCHISE_NAV.map((i) => i.label);
    expect(labels.indexOf("Allowance rules")).toBe(
      labels.indexOf("Employee statements") + 1
    );
    expect(
      franchiseNav((key) => key === "franchise.settings").map((i) => i.label)
    ).toEqual(["Allowance rules"]);
  });

  it("lists Spare parts directly above Tickets and Facility users last (Task 13)", () => {
    const labels = FRANCHISE_NAV.map((i) => i.label);
    expect(labels.indexOf("Spare parts")).toBe(labels.indexOf("Tickets") - 1);
    expect(labels.at(-1)).toBe("Facility users");
  });

  it("gives a facility operator Spare parts and Tickets — no Facility users", () => {
    const operator = new Set(["parts.handle", "franchise.tickets"]);
    expect(franchiseNav((key) => !!key && operator.has(key)).map((i) => i.label)).toEqual([
      "Spare parts",
      "Tickets",
    ]);
  });

  it("gives a facility admin Facility users as well", () => {
    const admin = new Set([
      "parts.handle",
      "franchise.tickets",
      "franchise.facility_users",
    ]);
    expect(franchiseNav((key) => !!key && admin.has(key)).map((i) => i.label)).toEqual([
      "Spare parts",
      "Tickets",
      "Facility users",
    ]);
  });

  it("keeps only Tickets for a tickets-only feature set", () => {
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

  it("lands a facility role on Spare parts — above Tickets (Task 13)", () => {
    const facility = new Set(["parts.handle", "franchise.tickets"]);
    expect(franchiseLanding((key) => !!key && facility.has(key))).toBe(
      "/franchise/parts"
    );
  });

  it("lands a tickets-only session on Tickets", () => {
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