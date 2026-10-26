import { describe, expect, it } from "vitest";
import type { TravelRule } from "@/types/allowances";
import {
  describeTravel,
  explainTravel,
  roadKm,
  tenths,
  travelAmountPaise,
} from "./travelPreview";

/** §6's F: free 20, step 2, ₹10, 130 %, max ₹300. */
const F: TravelRule = {
  freeKm: 20,
  stepKm: 2,
  paisePerStep: 1000,
  roadFactorPct: 130,
  maxPaisePerJob: 30000,
};
const withRule = (o: Partial<TravelRule>): TravelRule => ({ ...F, ...o });
/** Python's `rule()` helper in test_travel.py: an effectively uncapped rule. */
const uncapped = (o: Partial<TravelRule>): TravelRule =>
  withRule({ maxPaisePerJob: 10_000_000, ...o });

describe("explainTravel", () => {
  it("1. the index §3.5 example: 21.6 km straight is 4 steps, ₹40", () => {
    const x = explainTravel(21.6, F);
    expect(x.roadKm).toBe(28.1);
    expect(x.beyondKm).toBe(8.1);
    expect(x.steps).toBe(4);
    expect(x.rawPaise).toBe(4000);
    expect(x.amountPaise).toBe(4000);
    expect(x.capped).toBe(false);
    expect(x.off).toBe(false);
  });

  it("3. road km exactly at the free distance pays nothing", () => {
    // 20 km straight at 100 % is exactly 20.0 road km.
    const x = explainTravel(20, withRule({ roadFactorPct: 100 }));
    expect(x.roadKm).toBe(20);
    expect(x.beyondKm).toBe(0);
    expect(x.amountPaise).toBe(0);
  });

  it("4. one tenth short of a whole step pays nothing (partial dropped)", () => {
    // free 20 + step 2 − 0.1 = 21.9 road km.
    const x = explainTravel(21.9, withRule({ roadFactorPct: 100 }));
    expect(x.roadKm).toBe(21.9);
    expect(x.steps).toBe(0);
    expect(x.amountPaise).toBe(0);
  });

  it("5. exactly one step past the free distance pays one step", () => {
    const x = explainTravel(22, withRule({ roadFactorPct: 100 }));
    expect(x.steps).toBe(1);
    expect(x.amountPaise).toBe(1000);
  });

  it("6. 200 km straight hits the cap and says so", () => {
    const x = explainTravel(200, F);
    expect(x.amountPaise).toBe(30000);
    expect(x.rawPaise).toBeGreaterThan(30000);
    expect(x.capped).toBe(true);
  });

  it("7. a ₹0 rate is off, and pays nothing however far", () => {
    const x = explainTravel(200, withRule({ paisePerStep: 0 }));
    expect(x.off).toBe(true);
    expect(x.amountPaise).toBe(0);
    expect(x.capped).toBe(false);
  });

  it("8. step 1 km pays twice the steps of step 2 km on the same distance", () => {
    const two = explainTravel(30, withRule({ stepKm: 2, roadFactorPct: 100 }));
    const one = explainTravel(30, withRule({ stepKm: 1, roadFactorPct: 100 }));
    expect(two.steps).toBe(5);
    expect(one.steps).toBe(10);
  });

  it("9. a negative or NaN distance pays 0, never negative", () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const x = explainTravel(bad, F);
      expect(x.amountPaise).toBe(0);
      expect(x.steps).toBe(0);
      expect(x.rawPaise).toBe(0);
      expect(x.beyondKm).toBe(0);
    }
  });
});

describe("roadKm — half-up at the tenth", () => {
  it("2. rounds x.x5 up and x.x4999 down", () => {
    // 10 050 m at 100 % is 10.05 km → 10.1; 10 049.99 is 10.04999 → 10.0.
    expect(roadKm(10_050, 100)).toBe(10.1);
    expect(roadKm(10_049.99, 100)).toBe(10);
  });
  it("a negative distance or a factor below 1 reads 0 (Python raises)", () => {
    expect(roadKm(-1, 130)).toBe(0);
    expect(roadKm(1000, 0)).toBe(0);
  });
  it("tenths drops float drift", () => {
    expect(tenths(26.000000000000004)).toBe(260);
    expect(tenths(25.999999999999996)).toBe(260);
  });
});

/**
 * 10. THE PARITY TABLE — every row of `api/tests/unit/test_travel.py`, copied
 * verbatim (the comment on each is that file's test number). Both tables change
 * together: a rounding change on the server that is not copied here is exactly
 * what this block exists to catch.
 */
describe("parity with api/tests/unit/test_travel.py", () => {
  // road_km(straight_m, road_factor_pct) == expected
  const ROAD: [string, number, number, number][] = [
    ["test 1 worked example", 27_000, 130, 35.1],
    ["test 18 half up", 10_050, 100, 10.1],
    ["test 19 factor 100 is straight", 12_345, 100, 12.3],
    ["test 20 factor 300", 10_000, 300, 30.0],
    ["test 3 index §3.5", 21_600, 130, 28.1],
    ["test 12 road km", 120_000, 130, 156.0],
  ];
  it.each(ROAD)("road_km: %s", (_name, m, pct, expected) => {
    expect(roadKm(m, pct)).toBe(expected);
  });

  // travel_amount_paise(km, free_km, step_km, paise_per_step, max_paise)
  const AMOUNT: [string, number, [number, number, number, number], number][] = [
    ["test 2 27 km at 130 % (35.1 km)", 35.1, [20, 2, 1000, 30000], 7000],
    ["test 3 28.1 km", 28.1, [20, 2, 1000, 30000], 4000],
    ["test 4 exactly at free", 20.0, [20, 1, 1000, 10_000_000], 0],
    ["test 5 partial step dropped", 20.9, [20, 1, 1000, 10_000_000], 0],
    ["test 6 exactly one step", 21.0, [20, 1, 1000, 10_000_000], 1000],
    ["test 7 exact multiple of step", 24.0, [20, 2, 1000, 10_000_000], 2000],
    ["test 8 partial step dropped", 25.9, [20, 2, 1000, 10_000_000], 2000],
    ["test 9 step larger than distance past free", 25.0, [20, 10, 1000, 10_000_000], 0],
    ["test 10 below free is never negative", 5.0, [20, 1, 1000, 10_000_000], 0],
    ["test 11 zero km", 0.0, [20, 2, 1000, 10_000_000], 0],
    ["test 12 cap binds (156.0 km)", 156.0, [20, 2, 1000, 30000], 30000],
    ["test 13 cap equal to the amount", 24.0, [20, 2, 1000, 2000], 2000],
    ["test 14 rate zero (TA4 default)", 120.0, [20, 1, 0, 10_000_000], 0],
    ["test 15 max zero (TA4 default)", 120.0, [20, 1, 1000, 0], 0],
    ["test 16 float drift up", 26.000000000000004, [20, 2, 1000, 10_000_000], 3000],
    ["test 16 float drift down", 25.999999999999996, [20, 2, 1000, 10_000_000], 3000],
    ["test 17 free 0, 0.9 km", 0.9, [0, 1, 1000, 10_000_000], 0],
    ["test 17 free 0, 1.0 km", 1.0, [0, 1, 1000, 10_000_000], 1000],
  ];
  it.each(AMOUNT)("travel_amount_paise: %s", (_name, km, args, expected) => {
    const [freeKm, stepKm, paisePerStep, maxPaisePerJob] = args;
    expect(
      travelAmountPaise(km, uncapped({ freeKm, stepKm, paisePerStep, maxPaisePerJob }))
    ).toBe(expected);
  });

  it("test 21: out-of-range inputs read 0 where Python raises", () => {
    expect(travelAmountPaise(10, withRule({ stepKm: 0 }))).toBe(0);
    expect(travelAmountPaise(10, withRule({ paisePerStep: -1 }))).toBe(0);
    expect(travelAmountPaise(10, withRule({ maxPaisePerJob: -1 }))).toBe(0);
    expect(travelAmountPaise(10, withRule({ freeKm: -1 }))).toBe(0);
    expect(travelAmountPaise(-1, F)).toBe(0);
  });
});

describe("describeTravel — the worked lines", () => {
  it("prints the §1 example, line by line", () => {
    expect(describeTravel(21.6, F)).toEqual({
      lines: [
        "21.6 km × 130 % = 28.1 km by road",
        "8.1 km beyond the free 20 km = 4 steps of 2 km",
        "4 × ₹10 = ₹40",
      ],
      verdict: "Pays ₹40",
    });
  });

  it("adds the cap line when the cap cut the figure", () => {
    const d = describeTravel(200, F);
    expect(d.lines.at(-1)).toBe("Capped at ₹300");
    expect(d.verdict).toBe("Pays ₹300");
  });

  it("says so when the distance is within the free allowance", () => {
    const d = describeTravel(10, F);
    expect(d.lines).toEqual(["10 km × 130 % = 13 km by road"]);
    expect(d.verdict).toBe("Pays nothing — within the free distance");
  });

  it("says so when the allowance is off", () => {
    expect(describeTravel(200, withRule({ paisePerStep: 0 })).verdict).toBe(
      "Pays nothing — the allowance is off"
    );
  });

  it("a partial step past the free distance pays nothing and does not claim steps", () => {
    const d = describeTravel(21.9, withRule({ roadFactorPct: 100 }));
    expect(d.verdict).toBe("Pays nothing — within the free distance");
    expect(d.lines).toContain("1.9 km beyond the free 20 km = 0 steps of 2 km");
  });

  it("reads a single step in the singular", () => {
    const d = describeTravel(22, withRule({ roadFactorPct: 100 }));
    expect(d.lines).toContain("2 km beyond the free 20 km = 1 step of 2 km");
  });

  it("treats a negative or NaN distance as 0 km", () => {
    expect(describeTravel(Number.NaN, F).lines[0]).toBe(
      "0 km × 130 % = 0 km by road"
    );
  });
});
