import { describe, expect, it } from "vitest";
import { longestMatch, type NavMatchItem } from "./navMatch";
import { featureForPortalPath } from "@/components/vendor/portalNav";

/**
 * Task 09 §6 — `longestMatch` now decides the franchise portal's guard too
 * (`franchiseNav.ts` reads it), so the tie-breaking rules are pinned outside
 * `portalNav`'s tests for the first time.
 */
interface Item extends NavMatchItem {
  id: string;
}

const items: Item[] = [
  { to: "/portal/tickets", id: "list" },
  { to: "/portal/tickets/new", id: "new" },
  { to: "/portal/credit", id: "credit", match: ["/portal/credit/"] },
];

describe("longestMatch", () => {
  it("prefers the LONGER prefix — the detail route shades the list it sits inside", () => {
    expect(longestMatch(items, "/portal/tickets/new")?.id).toBe("new");
  });

  it("prefers an exact path over a prefix", () => {
    expect(longestMatch(items, "/portal/tickets")?.id).toBe("list");
  });

  it("honours the explicit `match` entries", () => {
    expect(longestMatch(items, "/portal/credit/payments/1")?.id).toBe("credit");
  });

  it("matches nothing it has not been told to", () => {
    expect(longestMatch(items, "/portal/users")).toBeUndefined();
    expect(longestMatch(items, "/franchise/tickets")).toBeUndefined();
  });
});

describe("portalNav regression", () => {
  it("still gates a credit payment page on vendor.credit", () => {
    expect(featureForPortalPath("/portal/credit/payments/1")).toBe(
      "vendor.credit"
    );
  });
});