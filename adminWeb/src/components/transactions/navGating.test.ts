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
import { SHELL_PATHS } from "@/lib/surface";
import { TRANSACTIONS_PATH } from "./surface";

/**
 * Epic 1.5: the same Transactions screen is mounted on four surfaces, each
 * behind its own guard table. These pin each table's answer, and that the
 * superadmin's landing page is its own entry.
 */
describe("company console", () => {
  it("gates /transactions on finance.transactions", () => {
    expect(featureForPath("/transactions")).toBe("finance.transactions");
  });
  it("does not shade a sibling", () => {
    expect(featureForPath("/tickets")).not.toBe("finance.transactions");
    expect(featureForPath("/franchise-settlements")).toBe("finance.settlements");
  });
});

describe("vendor portal", () => {
  it("gates Documents on vendor.credit - the key a vendor_user is not seeded", () => {
    expect(featureForPortalPath("/portal/documents")).toBe("vendor.credit");
  });
  it("shows Documents to a holder of vendor.credit and hides it from one without", () => {
    // `vendor` holds vendor.credit; `vendor_user` does not (seeded that way).
    const vendor = (key: string) => key === "vendor.credit";
    const vendorUser = () => false;
    const labels = (has: (k: string) => boolean) =>
      portalNav(["Manual"])
        .filter((i) => has(i.feature))
        .map((i) => i.label);
    expect(labels(vendor)).toContain("Documents");
    expect(labels(vendorUser)).not.toContain("Documents");
  });
});

describe("franchise portal", () => {
  it("gates Documents on franchise.documents", () => {
    expect(featureForFranchisePath("/franchise/documents")).toBe(
      "franchise.documents"
    );
    expect(
      franchiseNav((k) => k === "franchise.documents").map((i) => i.label)
    ).toEqual(["Documents"]);
  });
});

describe("superadmin console", () => {
  it("lands on Transactions, the first entry, with Companies still one click away", () => {
    expect(SUPERADMIN_NAV[0]?.label).toBe("Transactions");
    expect(SUPERADMIN_NAV[0]?.to).toBe(SHELL_PATHS.superadmin.home);
    expect(SUPERADMIN_NAV.map((i) => i.to)).toContain("/companies");
  });
  it("lights the right entry", () => {
    expect(activeSuperadminPath("/all-transactions")).toBe("/all-transactions");
    expect(activeSuperadminPath("/companies")).toBe("/companies");
  });
  it("does not share a URL with the company console's screen", () => {
    expect(TRANSACTIONS_PATH.superadmin).not.toBe(TRANSACTIONS_PATH.company);
    expect(TRANSACTIONS_PATH.superadmin).toBe(SHELL_PATHS.superadmin.home);
  });
});
