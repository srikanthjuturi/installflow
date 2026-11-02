import { describe, expect, it } from "vitest";
import {
  emptyValues,
  holdingSchema,
  isOverridden,
  paiseToRupees,
  resetGroup,
  rupeesToPaise,
  technicianRulesSchema,
  toFormValues,
  toRulesBody,
  type RulesFormValues,
} from "./technicianRulesSchema";
import type { TechnicianRulesInput } from "@/types/technicianRules";

const messages = (v: RulesFormValues) => {
  const r = technicianRulesSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("rupees and paise", () => {
  it("converts without float drift", () => {
    expect(rupeesToPaise("3200.5")).toBe(320050);
    expect(rupeesToPaise("450")).toBe(45000);
    expect(rupeesToPaise("0.07")).toBe(7);
  });
  it("refuses what is not a rupee amount", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1,000", "₹5"]) {
      expect(rupeesToPaise(bad)).toBeNull();
    }
  });
  it("round-trips back to bare digits", () => {
    expect(paiseToRupees(45000)).toBe("450");
    expect(paiseToRupees(45050)).toBe("450.50");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(paiseToRupees(null)).toBe("");
  });
});

describe("technicianRulesSchema", () => {
  it("accepts all-blank (everything inherits)", () => {
    expect(messages(emptyValues())).toEqual([]);
    expect(toRulesBody(emptyValues())).toEqual({
      payoutPercent: null,
      cancelPenaltiesPaise: null,
      bonusBandsPaise: null,
      speedRewardWithinHours: null,
      speedPenaltyAfterHours: null,
      speedRewardPaise: null,
      speedPenaltyPaise: null,
      travelFreeKm: null,
      travelPaisePerStep: null,
      travelMaxPaisePerJob: null,
      minRedeemablePaise: null,
    });
  });

  it("bounds the payout percent", () => {
    expect(messages({ ...emptyValues(), payoutPercent: "0" })).toHaveLength(1);
    expect(messages({ ...emptyValues(), payoutPercent: "301" })).toHaveLength(1);
    expect(messages({ ...emptyValues(), payoutPercent: "12.5" })).toHaveLength(1);
    expect(messages({ ...emptyValues(), payoutPercent: "120" })).toEqual([]);
  });

  it("wants exactly four penalties, or none", () => {
    const some = { ...emptyValues(), penalties: ["300", "", "", ""] };
    expect(messages(some)).toHaveLength(3);
    const all = { ...emptyValues(), penalties: ["300", "500", "800", "1200"] };
    expect(messages(all)).toEqual([]);
    expect(toRulesBody(all).cancelPenaltiesPaise).toEqual([30000, 50000, 80000, 120000]);
  });

  it("lets a penalty be zero but not a bonus", () => {
    expect(messages({ ...emptyValues(), penalties: ["0", "0", "0", "0"] })).toEqual([]);
    expect(messages({ ...emptyValues(), bonuses: ["0", "50", "100", "150"] })).toHaveLength(1);
  });

  it("makes speed all-or-none", () => {
    const partial = { ...emptyValues(), speedRewardHours: "4" };
    expect(messages(partial)).toHaveLength(3);
    const full = {
      ...emptyValues(),
      speedRewardHours: "4",
      speedPenaltyHours: "8",
      speedRewardRupees: "50",
      speedPenaltyRupees: "0",
    };
    expect(messages(full)).toEqual([]);
    expect(toRulesBody(full)).toMatchObject({
      speedRewardWithinHours: 4,
      speedPenaltyAfterHours: 8,
      speedRewardPaise: 5000,
      speedPenaltyPaise: 0,
    });
  });

  it("keeps the slow limit at or after the fast one", () => {
    const v = {
      ...emptyValues(),
      speedRewardHours: "8",
      speedPenaltyHours: "4",
      speedRewardRupees: "1",
      speedPenaltyRupees: "1",
    };
    expect(messages(v)).toEqual([
      "speedPenaltyHours: The slow limit cannot be sooner than the fast limit",
    ]);
    expect(messages({ ...v, speedPenaltyHours: "8" })).toEqual([]);
  });

  it("treats each travel box on its own", () => {
    expect(toRulesBody({ ...emptyValues(), travelFreeKm: "25" })).toMatchObject({
      travelFreeKm: 25,
      travelPaisePerStep: null,
      travelMaxPaisePerJob: null,
    });
    expect(messages({ ...emptyValues(), travelFreeKm: "501" })).toHaveLength(1);
  });

  it("allows a minimum of zero and bounds the top", () => {
    expect(messages({ ...emptyValues(), minRedeemableRupees: "0" })).toEqual([]);
    expect(messages({ ...emptyValues(), minRedeemableRupees: "10000001" })).toHaveLength(1);
  });
});

describe("inherit vs override state", () => {
  const server: TechnicianRulesInput = {
    payoutPercent: 120,
    cancelPenaltiesPaise: null,
    bonusBandsPaise: [10000, 20000, 30000, 40000],
    speedRewardWithinHours: null,
    speedPenaltyAfterHours: null,
    speedRewardPaise: null,
    speedPenaltyPaise: null,
    travelFreeKm: null,
    travelPaisePerStep: 500,
    travelMaxPaisePerJob: null,
    minRedeemablePaise: 100000,
  };

  it("reads null as an empty box and a value as an override", () => {
    const v = toFormValues(server);
    expect(isOverridden(v, "payout")).toBe(true);
    expect(isOverridden(v, "penalties")).toBe(false);
    expect(isOverridden(v, "bonuses")).toBe(true);
    expect(isOverridden(v, "speed")).toBe(false);
    expect(isOverridden(v, "travel")).toBe(true);
    expect(v.minRedeemableRupees).toBe("1000");
  });

  it("round-trips the server's set exactly", () => {
    expect(toRulesBody(toFormValues(server))).toEqual(server);
  });

  it("resets one group to inherit and leaves the rest", () => {
    const v = resetGroup(toFormValues(server), "bonuses");
    expect(isOverridden(v, "bonuses")).toBe(false);
    expect(v.payoutPercent).toBe("120");
    expect(toRulesBody(v).bonusBandsPaise).toBeNull();
  });
});

describe("holdingSchema", () => {
  it("allows 0 to release, needs a reason", () => {
    expect(holdingSchema.safeParse({ amountRupees: "0", reason: "Released" }).success).toBe(true);
    expect(holdingSchema.safeParse({ amountRupees: "0", reason: "ab" }).success).toBe(false);
    expect(holdingSchema.safeParse({ amountRupees: "x", reason: "Because" }).success).toBe(false);
    expect(
      holdingSchema.safeParse({ amountRupees: "2500.50", reason: "Damaged unit" }).success
    ).toBe(true);
  });
});
