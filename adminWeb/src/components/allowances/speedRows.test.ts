import { describe, expect, it } from "vitest";
import type { SpeedRule } from "@/types/allowances";
import { speedRowView, targetLabel } from "./speedRows";

const rule = (o: Partial<SpeedRule> = {}): SpeedRule => ({
  id: "r1",
  technicianType: "freelancer",
  targetKind: "node",
  targetId: "n-tv",
  targetName: "Television",
  targetPath: ["Electronics", "Television"],
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

describe("speedRowView", () => {
  it("joins the path with › and prints the two cells", () => {
    const v = speedRowView(rule());
    expect(v.target).toBe("Electronics › Television");
    expect(v.reward).toBe("Within 12 h · ₹200");
    expect(v.penalty).toBe("After 24 h · −₹150");
    expect(v.hint).toBeNull();
    expect(v.off).toBe(false);
  });

  it("does not repeat the name when the server's path already ends with it", () => {
    expect(targetLabel(rule({ targetPath: ["Electronics", "Television"] }))).toBe(
      "Electronics › Television"
    );
  });

  it("appends the name when the path is the ancestors alone", () => {
    expect(targetLabel(rule({ targetPath: ["Electronics"] }))).toBe(
      "Electronics › Television"
    );
  });

  it("falls back to the name when there is no path", () => {
    expect(targetLabel(rule({ targetPath: [] }))).toBe("Television");
  });

  it("a model reads the same way, product last", () => {
    const v = speedRowView(
      rule({
        targetKind: "model",
        targetName: 'Sunview 43"',
        targetPath: ["Electronics", "Television", 'Sunview 43"'],
      })
    );
    expect(v.target).toBe('Electronics › Television › Sunview 43"');
  });

  it("names the rule it overrides", () => {
    expect(speedRowView(rule({ overridesName: "Electronics" })).hint).toBe(
      "Overrides Electronics"
    );
  });

  it("pluralises how many deeper rules override this one", () => {
    expect(speedRowView(rule({ overriddenBy: 1 })).hint).toBe(
      "1 deeper rule overrides this"
    );
    expect(speedRowView(rule({ overriddenBy: 2 })).hint).toBe(
      "2 deeper rules override this"
    );
  });

  it("0 / 0 reads Off for this product, with a dash in each amount cell", () => {
    const v = speedRowView(rule({ rewardPaise: 0, penaltyPaise: 0 }));
    expect(v.hint).toBe("Off for this product");
    expect(v.off).toBe(true);
    expect(v.reward).toBe("—");
    expect(v.penalty).toBe("—");
  });

  it("a reward with no penalty dashes only the penalty", () => {
    const v = speedRowView(rule({ penaltyPaise: 0 }));
    expect(v.reward).toBe("Within 12 h · ₹200");
    expect(v.penalty).toBe("—");
    expect(v.off).toBe(false);
  });

  it("an inactive target reads No longer in the catalogue", () => {
    expect(speedRowView(rule({ targetActive: false })).hint).toBe(
      "No longer in the catalogue"
    );
  });

  it("combines hints in a fixed order", () => {
    const v = speedRowView(
      rule({
        targetActive: false,
        rewardPaise: 0,
        penaltyPaise: 0,
        overridesName: "Electronics",
        overriddenBy: 3,
      })
    );
    expect(v.hints).toEqual([
      "No longer in the catalogue",
      "Off for this product",
      "Overrides Electronics",
      "3 deeper rules override this",
    ]);
  });
});
