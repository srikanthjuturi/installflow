import { describe, expect, it } from "vitest";
import type { TicketSpeed, TicketTravel } from "@/types/allowances";
import {
  clockOrigin,
  formatHours,
  speedOutcome,
  speedRule,
  speedTimeTaken,
  TRAVEL_REASON,
  travelDistance,
  travelFrom,
  travelRule,
  travelStatus,
  travelTo,
} from "./allowanceWording";

const travel = (o: Partial<TicketTravel> = {}): TicketTravel => ({
  technicianId: "t1",
  acceptedAt: "2026-10-15T05:30:00Z",
  technicianType: "freelancer",
  baseSource: "pincode",
  customerSource: "ticket",
  straightKm: 21.6,
  roadFactorPct: 130,
  km: 28.1,
  freeKm: 20,
  stepKm: 2,
  paisePerStep: 1000,
  maxPaisePerJob: 30000,
  amountPaise: 4000,
  reason: null,
  creditedPaise: null,
  forceCloseDefaultPaise: 4000,
  forceCloseMaxPaise: 30000,
  ...o,
});

const speed = (o: Partial<TicketSpeed> = {}): TicketSpeed => ({
  matchedOn: "node",
  matchedName: "Television",
  rewardWithinHours: 12,
  penaltyAfterHours: 24,
  rewardPaise: 20000,
  penaltyPaise: 15000,
  clockStartedAt: "2026-10-16T10:00:00Z",
  acceptedAt: "2026-10-14T11:00:00Z",
  slotStart: "2026-10-16T10:00:00Z",
  completedAt: null,
  elapsedHours: null,
  partWaitHours: null,
  workingHours: null,
  outcome: "pending",
  ledgerEntryId: null,
  paidPaise: null,
  capped: false,
  reversed: false,
  ...o,
});

describe("formatHours", () => {
  it("prints hours and minutes", () => {
    expect(formatHours(9.4)).toBe("9 h 24 m");
    expect(formatHours(2.1)).toBe("2 h 6 m");
    expect(formatHours(0.25)).toBe("0 h 15 m");
    expect(formatHours(12)).toBe("12 h 0 m");
  });
  it("is a dash for missing or broken input and never negative", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours(Number.NaN)).toBe("—");
    expect(formatHours(-3)).toBe("0 h 0 m");
  });
});

describe("travel wording", () => {
  it("distance, from, to and rule", () => {
    expect(travelDistance(travel())).toBe(
      "28.1 km by road (21.6 km straight × 130 %)"
    );
    expect(travelFrom(travel())).toBe("Base · pincode centre");
    expect(travelFrom(travel({ baseSource: "map" }))).toBe("Base · map pin");
    expect(travelFrom(travel({ baseSource: "gps" }))).toBe("Base · phone location");
    expect(travelFrom(travel({ baseSource: "manual" }))).toBe(
      "Base · typed coordinates"
    );
    expect(travelFrom(travel({ baseSource: null }))).toBeNull();
    expect(travelTo(travel())).toBe("Customer's address pin");
    expect(travelTo(travel({ customerSource: "pincode" }))).toBe(
      "Customer's pincode centre"
    );
    expect(travelTo(travel({ customerSource: null }))).toBeNull();
    expect(travelRule(travel())).toBe("20 km free, then ₹10 per 2 km, up to ₹300");
  });

  it("the two reasons are said in words", () => {
    expect(TRAVEL_REASON.no_base_location).toBe(
      "No base location when accepted — nothing to pay."
    );
    expect(TRAVEL_REASON.no_customer_point).toBe(
      "No location for the customer — measured as 0 km."
    );
  });

  it("status: paid, paid when the customer confirms, not paid", () => {
    expect(travelStatus(travel({ creditedPaise: 4000 }), "Closed")).toBe("Paid ₹40");
    expect(travelStatus(travel(), "Awaiting Customer")).toBe(
      "Paid when the customer confirms"
    );
    expect(travelStatus(travel(), "Force-Closed")).toBe("Not paid");
    expect(travelStatus(travel({ amountPaise: 0 }), "In Progress")).toBe(
      "Not paid"
    );
  });
});

describe("speed wording", () => {
  it("rule: product vs category", () => {
    expect(speedRule(speed())).toBe("Category: Television");
    expect(speedRule(speed({ matchedOn: "model", matchedName: 'Sunview 43"' }))).toBe(
      'Product: Sunview 43"'
    );
  });

  it("clock origin: the slot when it equals the clock, else the accept", () => {
    expect(clockOrigin(speed())).toBe("(start of the slot)");
    expect(
      clockOrigin(
        speed({
          clockStartedAt: "2026-10-14T11:00:00Z",
          slotStart: "2026-10-14T09:00:00Z",
        })
      )
    ).toBe("(when it was accepted)");
    expect(clockOrigin(speed({ slotStart: null }))).toBe("(when it was accepted)");
  });

  it("time taken: measured, with the part wait, or the running clock", () => {
    expect(speedTimeTaken(speed({ workingHours: 9.4 }))).toBe("9 h 24 m");
    expect(speedTimeTaken(speed({ workingHours: 9.4, partWaitHours: 2.1 }))).toBe(
      "9 h 24 m, excluding 2 h 6 m waiting for parts"
    );
    expect(speedTimeTaken(speed({ workingHours: 3, partWaitHours: 0 }))).toBe(
      "3 h 0 m"
    );
    expect(speedTimeTaken(speed())).toMatch(/^Clock started .+ \(start of the slot\)$/);
    expect(speedTimeTaken(speed({ clockStartedAt: null }))).toBe("—");
  });

  it("outcomes", () => {
    expect(speedOutcome(speed({ outcome: "pending" })).text).toBe(
      "Settled when the customer confirms"
    );
    expect(speedOutcome(speed({ outcome: "reward", paidPaise: 20000 })).text).toBe(
      "Rewarded ₹200"
    );
    expect(speedOutcome(speed({ outcome: "penalty", paidPaise: 15000 })).text).toBe(
      "Penalised −₹150"
    );
    expect(speedOutcome(speed({ outcome: "none" })).text).toBe(
      "Neither — between the two"
    );
    expect(speedOutcome(speed({ outcome: "force_closed" })).text).toBe(
      "Not paid — force-closed"
    );
  });

  it("capped and reversed ride beside the outcome", () => {
    const o = speedOutcome(
      speed({ outcome: "penalty", paidPaise: 5000, capped: true, reversed: true })
    );
    expect(o.notes).toEqual(["capped by the monthly limit", "reversed"]);
    expect(speedOutcome(speed({ outcome: "none" })).notes).toEqual([]);
  });

  it("a penalty the cap cut to no row reads ₹0, not a dash", () => {
    expect(
      speedOutcome(speed({ outcome: "penalty", paidPaise: null, capped: true })).text
    ).toBe("Penalised ₹0");
  });
});
