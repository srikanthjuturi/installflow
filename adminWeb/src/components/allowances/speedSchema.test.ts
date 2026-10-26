import { describe, expect, it } from "vitest";
import type { SpeedRule } from "@/types/allowances";
import {
  emptySpeedValues,
  speedRowSchema,
  toSpeedBody,
  toSpeedValues,
  validateSpeedRow,
  type SpeedRowValues,
} from "./speedSchema";

const row = (o: Partial<SpeedRowValues> = {}): SpeedRowValues => ({
  ...emptySpeedValues(),
  targetKind: "node",
  targetId: "n-tv",
  targetName: "Television",
  rewardWithinHours: "12",
  rewardRupees: "200",
  penaltyAfterHours: "24",
  penaltyRupees: "150",
  ...o,
});

const rule = (o: Partial<SpeedRule> = {}): SpeedRule => ({
  id: "r1",
  technicianType: "freelancer",
  targetKind: "node",
  targetId: "n-tv",
  targetName: "Television",
  targetPath: ["Electronics"],
  targetActive: true,
  rewardWithinHours: 12,
  penaltyAfterHours: 24,
  rewardPaise: 20000,
  penaltyPaise: 15000,
  overridesRuleId: null,
  overridesName: null,
  overriddenBy: 0,
  updatedAt: "2026-10-15T05:30:00Z",
  ...o,
});

describe("validateSpeedRow", () => {
  it("accepts a valid row", () => {
    expect(validateSpeedRow(row(), [])).toEqual({});
  });

  it("puts a penalty that starts before the reward ends on the penalty hours", () => {
    expect(
      validateSpeedRow(row({ rewardWithinHours: "24", penaltyAfterHours: "12" }), [])
    ).toEqual({
      penaltyAfterHours: "The penalty can't start before the reward ends",
    });
  });

  it("allows equal hours", () => {
    expect(
      validateSpeedRow(row({ rewardWithinHours: "12", penaltyAfterHours: "12" }), [])
    ).toEqual({});
  });

  it("allows 0 / 0 — one product switched off", () => {
    expect(
      validateSpeedRow(row({ rewardRupees: "0", penaltyRupees: "0" }), [])
    ).toEqual({});
  });

  it("allows a reward with no penalty", () => {
    expect(validateSpeedRow(row({ penaltyRupees: "0" }), [])).toEqual({});
  });

  it.each(["0", "721", "1.5", "", "abc"])("refuses %j hours", (h) => {
    const e = validateSpeedRow(
      row({ rewardWithinHours: h, penaltyAfterHours: h }),
      []
    );
    expect(e.rewardWithinHours).toBe("Between 1 and 720 hours");
    expect(e.penaltyAfterHours).toBe("Between 1 and 720 hours");
  });

  it("allows the 720-hour edge", () => {
    expect(
      validateSpeedRow(
        row({ rewardWithinHours: "720", penaltyAfterHours: "720" }),
        []
      )
    ).toEqual({});
  });

  it("refuses ₹10,001 and a decimal, allows ₹10,000", () => {
    expect(validateSpeedRow(row({ rewardRupees: "10001" }), [])).toEqual({
      rewardRupees: "Up to ₹10,000",
    });
    expect(validateSpeedRow(row({ penaltyRupees: "99.5" }), [])).toEqual({
      penaltyRupees: "Enter a whole number of rupees",
    });
    expect(validateSpeedRow(row({ penaltyRupees: "10000" }), [])).toEqual({});
  });

  it("asks for a target", () => {
    expect(validateSpeedRow(row({ targetKind: "", targetId: "" }), [])).toEqual({
      targetId: "Choose category or product",
    });
  });

  it("refuses a duplicate type + target on add, naming it", () => {
    expect(validateSpeedRow(row(), [rule()])).toEqual({
      targetId:
        "There is already a rule for Television for Freelancers. Edit that one instead.",
    });
  });

  it("passes the same target for the other type", () => {
    expect(
      validateSpeedRow(row({ technicianType: "Employee" }), [rule()])
    ).toEqual({});
  });

  it("does not confuse a node with a model of the same id", () => {
    expect(
      validateSpeedRow(row({ targetKind: "model" }), [rule({ targetKind: "node" })])
    ).toEqual({});
  });

  it("an edit does not duplicate itself", () => {
    expect(validateSpeedRow(row(), [rule()], "r1")).toEqual({});
  });
});

describe("speedRowSchema + conversions", () => {
  it("surfaces the pure function's messages as issues on their fields", () => {
    const r = speedRowSchema([rule()]).safeParse(row());
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["targetId"]);
  });

  it("round-trips a rule through the form to a PUT body (rupees to paise)", () => {
    expect(toSpeedBody(toSpeedValues(rule()))).toEqual({
      technicianType: "freelancer",
      nodeId: "n-tv",
      modelId: null,
      rewardWithinHours: 12,
      penaltyAfterHours: 24,
      rewardPaise: 20000,
      penaltyPaise: 15000,
    });
  });

  it("sends exactly one of nodeId / modelId", () => {
    const body = toSpeedBody(row({ targetKind: "model", targetId: "m-1" }));
    expect(body.nodeId).toBeNull();
    expect(body.modelId).toBe("m-1");
  });
});
