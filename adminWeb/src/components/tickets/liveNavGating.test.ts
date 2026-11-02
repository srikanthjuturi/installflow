import { describe, expect, it } from "vitest";
import { featureForPath } from "@/components/shared/nav";
import {
  featureForFranchisePath,
  franchiseNav,
} from "@/components/franchise/franchiseNav";
import {
  featureForPortalPath,
  portalNav,
} from "@/components/vendor/portalNav";
import {
  SUPERADMIN_NAV,
  activeSuperadminPath,
} from "@/components/superadmin/superadminNav";
import { LIVE_TECHNICIANS_PATH } from "./liveSurface";

/**
 * Epic 4: the same Live technicians page is mounted on four surfaces, each
 * behind its own guard table. These pin each table's answer.
 */
describe("company console", () => {
  it("gates /live-technicians on jobs.view", () => {
    expect(featureForPath("/live-technicians")).toBe("jobs.view");
  });
  it("does not shade a sibling", () => {
    expect(featureForPath("/transactions")).toBe("finance.transactions");
    expect(featureForPath("/escalations")).toBe("jobs.assign");
  });
});

describe("vendor portal", () => {
  it("gates Live technicians like Documents, on vendor.credit", () => {
    expect(featureForPortalPath("/portal/live-technicians")).toBe(
      "vendor.credit"
    );
    const vendor = (key: string) => key === "vendor.credit";
    const vendorUser = () => false;
    const labels = (has: (k: string) => boolean) =>
      portalNav(["Manual"])
        .filter((i) => has(i.feature))
        .map((i) => i.label);
    expect(labels(vendor)).toContain("Live technicians");
    expect(labels(vendorUser)).not.toContain("Live technicians");
  });
});

describe("franchise portal", () => {
  it("gates Live technicians on franchise.tickets", () => {
    expect(featureForFranchisePath("/franchise/live-technicians")).toBe(
      "franchise.tickets"
    );
    expect(
      franchiseNav((k) => k === "franchise.tickets").map((i) => i.label)
    ).toEqual(["Tickets", "Live technicians"]);
  });
});

describe("superadmin console", () => {
  it("has its own entry and lights it", () => {
    expect(SUPERADMIN_NAV.map((i) => i.to)).toContain("/all-live-technicians");
    expect(activeSuperadminPath("/all-live-technicians")).toBe(
      "/all-live-technicians"
    );
  });
  it("does not share a URL with the company console's page", () => {
    expect(LIVE_TECHNICIANS_PATH.superadmin).not.toBe(
      LIVE_TECHNICIANS_PATH.company
    );
    expect(new Set(Object.values(LIVE_TECHNICIANS_PATH)).size).toBe(4);
  });
});
