import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/types";
import { isReversible, ledgerFileName, toTicketPenalty } from "./ledgerAdapters";

/**
 * Task 09 §6 — the one translation between a pool row and the reversal dialog,
 * and the CSV names both tables build.
 */
function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "e-1",
    at: "2026-09-14T10:00:00Z",
    kind: "penalty",
    amountPaise: 50000,
    technicianId: "t-1",
    technicianName: "Ravi Kumar",
    ticketId: "tk-1",
    ticketCode: "INST-240912",
    reason: "Cancelled 2 hours before the slot",
    reversed: false,
    franchiseeId: "f-1",
    technicianType: "freelancer",
    ...overrides,
  };
}

describe("isReversible", () => {
  it("is true for a standing penalty", () => {
    expect(isReversible(entry())).toBe(true);
  });

  it("is false once the reversal has already been recorded", () => {
    expect(isReversible(entry({ reversed: true }))).toBe(false);
  });

  it("is false for a bonus, a reversal row, or anything the pool does not charge", () => {
    expect(isReversible(entry({ kind: "bonus" }))).toBe(false);
    expect(isReversible(entry({ kind: "reversal" }))).toBe(false);
    expect(isReversible(entry({ kind: "travel" }))).toBe(false);
  });

  it("is true for a speed penalty — the same money a later task charges", () => {
    expect(isReversible(entry({ kind: "speed_penalty" }))).toBe(true);
  });
});

describe("toTicketPenalty", () => {
  it("copies the money and the man, and nulls the fields a live row never carries", () => {
    const p = toTicketPenalty(entry());
    expect(p.id).toBe("e-1");
    expect(p.technicianName).toBe("Ravi Kumar");
    expect(p.amountPaise).toBe(50000);
    expect(p.reason).toBe("Cancelled 2 hours before the slot");
    expect(p.chargedAt).toBe("2026-09-14T10:00:00Z");
    expect(p.reversedAt).toBeNull();
    expect(p.reversedByName).toBeNull();
    expect(p.reversalReason).toBeNull();
    // §5.10's per-row answer, restated from the entry: the driver has already
    // gated on `isReversible`, so the dialog's subject says the same thing.
    expect(p.canReverse).toBe(true);
    expect(
      toTicketPenalty(entry({ reversed: true })).canReverse
    ).toBe(false);
  });
});

describe("ledgerFileName", () => {
  it("names company AND franchisee in the franchise workspace", () => {
    expect(ledgerFileName("Acme Appliances", "SkyFix Services")).toBe(
      "acme-appliances-skyfix-services-ledger.csv"
    );
  });

  it("keeps today's company-only name when no franchisee is named (regression)", () => {
    expect(ledgerFileName("Acme Appliances")).toBe(
      "acme-appliances-ledger.csv"
    );
    expect(ledgerFileName("Acme Appliances", undefined)).toBe(
      "acme-appliances-ledger.csv"
    );
  });
});