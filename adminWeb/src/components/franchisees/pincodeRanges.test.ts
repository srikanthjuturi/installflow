import { describe, expect, it } from "vitest";
import type { PincodeChange } from "@/types/franchisee";
import {
  canApply,
  checkRangeSyntax,
  formatCount,
  normaliseRangeText,
  previewImpact,
  previewSummary,
} from "./pincodeRanges";

/* The range grammar, checked against §6's cases one for one. The server
   (`api/app/core/pincode_ranges.py`) stays the authority — these pin the
   browser's mirror of it so the two cannot drift apart unnoticed. */

describe("checkRangeSyntax", () => {
  it("accepts a range plus a single pincode: 2 entries, span 100", () => {
    const check = checkRangeSyntax("500001-500099, 500120");
    expect(check).toEqual({ ok: true, entries: 2, span: 100 });
  });

  it("accepts newline and semicolon separators like a pasted column", () => {
    expect(checkRangeSyntax("500001\n500002\n500003")).toEqual({
      ok: true,
      entries: 3,
      span: 3,
    });
    expect(checkRangeSyntax("500001; 500002;500110")).toEqual({
      ok: true,
      entries: 3,
      span: 3,
    });
  });

  it("accepts an en dash", () => {
    expect(checkRangeSyntax("500001–500010")).toEqual({
      ok: true,
      entries: 1,
      span: 10,
    });
  });

  it("accepts spaces around the dash", () => {
    expect(checkRangeSyntax("500001 - 500099")).toEqual({
      ok: true,
      entries: 1,
      span: 99,
    });
  });

  it("refuses a leading zero", () => {
    const check = checkRangeSyntax("050001");
    expect(check).toMatchObject({ ok: false, reason: "bad-token" });
  });

  it("refuses a short token and names it", () => {
    const check = checkRangeSyntax("500001, 5000");
    expect(check).toEqual({ ok: false, reason: "bad-token", token: "5000" });
  });

  it("refuses a range that runs backwards", () => {
    const check = checkRangeSyntax("500099-500001");
    expect(check).toEqual({ ok: false, reason: "backwards", token: "500099-500001" });
  });

  it("merges overlapping ranges into one span", () => {
    expect(checkRangeSyntax("500001-500010, 500005-500020")).toEqual({
      ok: true,
      entries: 2,
      span: 20,
    });
  });

  it("counts a duplicate entry once in the span", () => {
    expect(checkRangeSyntax("500030, 500030")).toEqual({
      ok: true,
      entries: 2,
      span: 1,
    });
  });

  it("refuses more than 500 entries", () => {
    const many = Array.from({ length: 501 }, (_, i) => 500001 + i).join(",");
    expect(checkRangeSyntax(many)).toEqual({ ok: false, reason: "too-many" });
    // Dropping the last entry's ",500501" is exactly the ceiling — 500 entries.
    expect(checkRangeSyntax(many.slice(0, -7))).toMatchObject({ ok: true });
  });

  it("treats empty and whitespace-only text as the hand-everything-back answer", () => {
    expect(checkRangeSyntax("")).toEqual({ ok: false, reason: "empty" });
    expect(checkRangeSyntax("   \n\t")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("normaliseRangeText", () => {
  it("unifies separators, dashes and spacing", () => {
    expect(normaliseRangeText(" 500030 -500040 ;500120\n")).toBe(
      "500030-500040, 500120"
    );
  });
});

/* Fakes for the preview's read-only helpers. Only the counts matter here — the
   dialog renders the real wire types elsewhere. */

function change(overrides: Partial<PincodeChange> = {}): PincodeChange {
  return {
    dryRun: true,
    franchiseeId: "f-1",
    pincodeRanges: "500001-500010",
    resolvedCount: 10,
    unknownCount: 0,
    emptyRanges: [],
    added: { count: 0, ranges: "500001-500010" },
    removed: { count: 0, ranges: "" },
    clashes: [],
    clashCount: 0,
    movedTechnicians: [],
    trimmedTechnicians: [],
    invitesChanged: [],
    restampedTickets: { count: 0, sample: [] },
    assignedTicketsKept: 0,
    ...overrides,
  };
}

describe("previewImpact and canApply", () => {
  it("a clash blocks apply even when nothing else is wrong", () => {
    const plan = change({ clashCount: 1 });
    expect(canApply(plan)).toBe(false);
    expect(canApply(change({ clashCount: 0 }))).toBe(true);
    // A clash alone is a blocking state, not an impact: nothing moves.
    expect(previewImpact(plan).any).toBe(false);
  });

  it("undefined means no plan has arrived — never applyable", () => {
    expect(canApply(undefined)).toBe(false);
  });

  it("zero moved, trimmed and re-stamped is no impact", () => {
    const impact = previewImpact(change());
    expect(impact).toEqual({ moved: 0, trimmed: 0, tickets: 0, any: false });
  });
});

describe("previewSummary", () => {
  it("omits the skipped line when nothing is unknown", () => {
    const lines = previewSummary(change(), "Home Franchisee");
    expect(lines).not.toContain(
      expect.stringContaining("not in the pincode master")
    );
    expect(lines[0]).toBe("10 pincodes");
    expect(lines).toContain("No technicians or tickets are affected.");
  });

  it("names the home franchisee when pincodes are handed back", () => {
    const lines = previewSummary(
      change({ removed: { count: 4, ranges: "500005-500008" } }),
      "Home Franchisee"
    );
    expect(lines).toContain("4 pincodes handed back to Home Franchisee");
  });

  it("says 1 pincode, never 1 pincodes", () => {
    expect(previewSummary(change({ resolvedCount: 1 }), "Home").at(0)).toBe(
      "1 pincode"
    );
    expect(formatCount(1, "pincode", "pincodes")).toBe("1 pincode");
    expect(formatCount(2, "pincode", "pincodes")).toBe("2 pincodes");
  });
});