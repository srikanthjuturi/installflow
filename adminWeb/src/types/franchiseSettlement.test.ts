import { describe, expect, it } from "vitest";
import {
  canDecide,
  directionLabel,
  paiseToRupees,
  rupeesToPaise,
  type Settlement,
} from "./franchiseSettlement";

const row = (over: Partial<Settlement>): Settlement => ({
  id: "1",
  code: "STL-1",
  franchiseeId: "f",
  franchiseeName: "SkyFix",
  direction: "franchisee_to_company",
  amountPaise: 100,
  reason: "lease",
  note: null,
  transferredOn: "2026-10-01",
  utr: null,
  proofUrl: null,
  state: "awaiting",
  waitingOn: "company",
  recordedByLabel: null,
  createdAt: "2026-10-01T00:00:00Z",
  confirmedAt: null,
  confirmedByLabel: null,
  declinedAt: null,
  declinedByLabel: null,
  declineReason: null,
  documentNumber: null,
  ...over,
});

describe("canDecide", () => {
  it("lets the company decide a transfer waiting on it, and no one else", () => {
    const r = row({ waitingOn: "company" });
    expect(canDecide(r, "staff")).toBe(true);
    expect(canDecide(r, "portal")).toBe(false);
  });

  it("lets the franchisee decide a transfer waiting on it, and no one else", () => {
    const r = row({ direction: "company_to_franchisee", waitingOn: "franchisee" });
    expect(canDecide(r, "portal")).toBe(true);
    expect(canDecide(r, "staff")).toBe(false);
  });

  it("offers nothing on a decided row", () => {
    expect(canDecide(row({ state: "settled", waitingOn: null }), "staff")).toBe(false);
    expect(canDecide(row({ state: "declined", waitingOn: null }), "portal")).toBe(
      false
    );
  });
});

describe("directionLabel", () => {
  it("speaks in the viewer's own words", () => {
    expect(directionLabel("company_to_franchisee", "staff")).toBe("Paid to franchisee");
    expect(directionLabel("franchisee_to_company", "staff")).toBe(
      "Received from franchisee"
    );
    expect(directionLabel("franchisee_to_company", "portal")).toBe("Sent to company");
    expect(directionLabel("company_to_franchisee", "portal")).toBe(
      "Received from company"
    );
  });
});

describe("rupees and paise", () => {
  it("converts without floating-point drift", () => {
    expect(rupeesToPaise(3200.5)).toBe(320050);
    expect(rupeesToPaise(0.29)).toBe(29);
    expect(paiseToRupees(320050)).toBe(3200.5);
  });
});
