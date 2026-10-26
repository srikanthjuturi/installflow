import { describe, expect, it } from "vitest";
import type { FranchiseeOption } from "@/types/franchisee";
import type {
  TechnicianTransfer,
  TechnicianTransferResult,
  TransferBlocker,
} from "@/types/technician";
import {
  blockerLines,
  canConfirm,
  coverageSummary,
  historyDate,
  historyLine,
  nothingInsideRange,
  rangeMatcher,
  reasonProblem,
  targetOptions,
} from "./transferPlan";

function result(o: Partial<TechnicianTransferResult> = {}): TechnicianTransferResult {
  return {
    dryRun: true,
    technicianId: "t1",
    technicianCode: "TCH-4021",
    technicianName: "Ravi Kumar",
    technicianType: "freelancer",
    fromFranchiseeId: "h",
    fromFranchiseeName: "Acme Appliances",
    fromFranchiseeIsHome: true,
    toFranchiseeId: "s",
    toFranchiseeName: "SkyFix Services",
    toFranchiseeIsHome: false,
    coverage: {
      source: "kept",
      kept: ["500031", "500032"],
      trimmed: [],
      added: [],
      after: ["500031", "500032"],
      keptCount: 2,
      trimmedCount: 0,
      addedCount: 0,
      regionBefore: "South",
      regionAfter: "South",
      regionChanged: false,
    },
    blockers: [],
    warnings: [],
    canTransfer: true,
    transfer: null,
    ...o,
  };
}

const jobs: TransferBlocker = {
  code: "TECHNICIAN_HAS_OPEN_JOBS",
  message: "TCH-4021 still has 1 open job. Finish or reassign it first.",
  openJobs: 1,
};
const balance: TransferBlocker = {
  code: "TECHNICIAN_HAS_BALANCE",
  message:
    "Ravi Kumar still has ₹1,240 waiting to be redeemed. Let them redeem it and be paid, then move them.",
  redeemablePaise: 124000,
};

describe("reasonProblem", () => {
  it("refuses nothing, blanks and four characters", () => {
    expect(reasonProblem("")).toEqual(expect.any(String));
    expect(reasonProblem("   ")).toEqual(expect.any(String));
    expect(reasonProblem("abcd")).toEqual(expect.any(String));
    expect(reasonProblem("  abcd  ")).toEqual(expect.any(String));
  });

  it("accepts five characters, trimmed", () => {
    expect(reasonProblem("abcde")).toBeNull();
    expect(reasonProblem("  abcde  ")).toBeNull();
  });

  it("refuses more than 255", () => {
    expect(reasonProblem("x".repeat(255))).toBeNull();
    expect(reasonProblem("x".repeat(256))).toEqual(expect.any(String));
  });

  it("names who is being moved when it is told", () => {
    expect(reasonProblem("", "Ravi Kumar")).toBe(
      "Say why Ravi Kumar is being moved (at least 5 characters)"
    );
  });
});

describe("coverageSummary", () => {
  it("says All n stay when nothing changes", () => {
    expect(coverageSummary({ keptCount: 3, trimmedCount: 0, addedCount: 0 })).toBe(
      "All 3 stay"
    );
  });

  it("adds what was taken off, and what was added", () => {
    expect(coverageSummary({ keptCount: 2, trimmedCount: 1, addedCount: 0 })).toBe(
      "2 stay · 1 taken off"
    );
    expect(coverageSummary({ keptCount: 2, trimmedCount: 1, addedCount: 1 })).toBe(
      "2 stay · 1 taken off · 1 added"
    );
    expect(coverageSummary({ keptCount: 0, trimmedCount: 0, addedCount: 2 })).toBe(
      "0 stay · 2 added"
    );
  });
});

describe("blockerLines", () => {
  it("keeps the server's order and does not reword it", () => {
    expect(blockerLines([jobs, balance])).toEqual([jobs.message, balance.message]);
    expect(blockerLines([balance, jobs])).toEqual([balance.message, jobs.message]);
    expect(blockerLines([])).toEqual([]);
  });
});

describe("canConfirm", () => {
  const clean = result();

  it("is false with no preview", () => {
    expect(canConfirm(undefined, "a good reason", false)).toBe(false);
  });

  it("is false while anything is in the way", () => {
    expect(
      canConfirm(result({ blockers: [jobs], canTransfer: false }), "a good reason", false)
    ).toBe(false);
  });

  it("is false when the server says it cannot, whatever the blockers list", () => {
    expect(canConfirm(result({ canTransfer: false }), "a good reason", false)).toBe(false);
  });

  it("is false with a four-character reason", () => {
    expect(canConfirm(clean, "four", false)).toBe(false);
    expect(canConfirm(clean, "     ", false)).toBe(false);
  });

  it("is false while a preview or the move is in flight", () => {
    expect(canConfirm(clean, "a good reason", true)).toBe(false);
  });

  it("is true for a clean preview and a five-character reason", () => {
    expect(canConfirm(clean, "abcde", false)).toBe(true);
  });
});

describe("nothingInsideRange", () => {
  const nothing = result({
    coverage: {
      source: "kept",
      kept: [],
      trimmed: ["500045"],
      added: [],
      after: [],
      keptCount: 0,
      trimmedCount: 1,
      addedCount: 0,
      regionBefore: "South",
      regionAfter: "South",
      regionChanged: false,
    },
    blockers: [
      {
        code: "PINCODE_OUTSIDE_FRANCHISEE",
        message:
          "None of TCH-4021's pincodes is inside SkyFix Services's area. Choose the pincodes SkyFix Services should serve.",
      },
    ],
    canTransfer: false,
  });

  it("is the preview that kept nothing and answers PINCODE_OUTSIDE_FRANCHISEE", () => {
    expect(nothingInsideRange(nothing)).toBe(true);
  });

  it("is not a custom pick the server found outside the area", () => {
    expect(
      nothingInsideRange({
        ...nothing,
        coverage: { ...nothing.coverage, source: "supplied" },
      })
    ).toBe(false);
  });

  it("is not a clean preview, an unrelated blocker or no preview", () => {
    expect(nothingInsideRange(result())).toBe(false);
    expect(nothingInsideRange(result({ blockers: [jobs], canTransfer: false }))).toBe(false);
    expect(nothingInsideRange(undefined)).toBe(false);
  });
});

describe("targetOptions", () => {
  const f = (
    o: Partial<FranchiseeOption> & { id: string; name: string }
  ): FranchiseeOption => ({
    code: o.id.toUpperCase(),
    kind: "external",
    isHome: false,
    isActive: true,
    ...o,
  });
  const opts = [
    f({ id: "a", name: "Alpha" }),
    f({ id: "h", name: "Acme Appliances", isHome: true, kind: "internal" }),
    f({ id: "z", name: "Zed", isActive: false }),
  ];

  it("leaves out where the technician already is", () => {
    expect(targetOptions(opts, "a").map((o) => o.value)).not.toContain("a");
  });

  it("puts home first and keeps the rest in the order given", () => {
    expect(targetOptions(opts, "none").map((o) => o.value)).toEqual(["h", "a", "z"]);
    expect(targetOptions(opts, "none")[0].label).toBe("Acme Appliances (home)");
  });

  it("lists an inactive one disabled, its label ending (inactive)", () => {
    const zed = targetOptions(opts, "h").find((o) => o.value === "z");
    expect(zed).toEqual({ value: "z", label: "Zed (inactive)", disabled: true });
    expect(targetOptions(opts, "h").find((o) => o.value === "a")?.disabled).toBe(false);
  });
});

describe("historyLine", () => {
  const row = (o: Partial<TechnicianTransfer> = {}): TechnicianTransfer => ({
    id: "x",
    at: "2026-10-16T08:00:00Z",
    technicianId: "t1",
    fromFranchiseeId: "h",
    fromFranchiseeName: "Acme Appliances",
    toFranchiseeId: "s",
    toFranchiseeName: "SkyFix Services",
    technicianType: "freelancer",
    reason: "Ravi moved east",
    byUserId: "u",
    byName: "Nisha Rao",
    kept: ["500031", "500032"],
    trimmed: ["500045"],
    added: [],
    ...o,
  });

  it("writes the date in India, who moved where, and by whom", () => {
    expect(historyLine(row()).head).toBe(
      "16-10-2026 · Acme Appliances → SkyFix Services · by Nisha Rao"
    );
  });

  it("uses the Indian day, not the browser's", () => {
    // 20:00 UTC is already the next day in India.
    expect(historyDate("2026-10-15T20:00:00Z")).toBe("16-10-2026");
  });

  it("names the pincodes that came off", () => {
    expect(historyLine(row()).detail).toBe(
      "“Ravi moved east” · 2 pincodes stayed · 1 taken off (500045)"
    );
  });

  it("says All n pincodes stayed when none came off", () => {
    const line = historyLine(row({ kept: ["500031", "500032", "500033"], trimmed: [] }));
    expect(line.detail).toContain("All 3 pincodes stayed");
  });

  it("names the pincodes added by a custom pick", () => {
    expect(historyLine(row({ added: ["500033"], kept: ["500031"] })).detail).toContain(
      "1 added (500033)"
    );
  });
});

describe("rangeMatcher", () => {
  it("matches a range and a single code, edges included", () => {
    const m = rangeMatcher("500030-500040, 500120");
    expect(m?.("500030")).toBe(true);
    expect(m?.("500040")).toBe(true);
    expect(m?.("500120")).toBe(true);
    expect(m?.("500041")).toBe(false);
    expect(m?.("500029")).toBe(false);
  });

  it("is null when there is nothing to limit by, or the text is unfamiliar", () => {
    expect(rangeMatcher("")).toBeNull();
    expect(rangeMatcher("   ")).toBeNull();
    expect(rangeMatcher("abc")).toBeNull();
  });
});
