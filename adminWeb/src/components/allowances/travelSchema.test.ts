import { describe, expect, it } from "vitest";
import type { TravelRules } from "@/types/allowances";
import {
  MAX_NEEDED,
  previewRule,
  toTravelBody,
  toTravelValues,
  travelSchema,
  type TravelValues,
} from "./travelSchema";

const SERVER: TravelRules = {
  freelancer: {
    freeKm: 20,
    stepKm: 2,
    paisePerStep: 1000,
    roadFactorPct: 130,
    maxPaisePerJob: 30000,
  },
  employee: {
    freeKm: 30,
    stepKm: 1,
    paisePerStep: 0,
    roadFactorPct: 130,
    maxPaisePerJob: 0,
  },
};

const valid = (): TravelValues => toTravelValues(SERVER);
const errorsOf = (values: TravelValues) => {
  const r = travelSchema.safeParse(values);
  return r.success ? [] : r.error.issues.map((i) => [i.path.join("."), i.message]);
};

describe("travel form values", () => {
  it("round-trips the server's rules through rupees and back to paise", () => {
    const values = toTravelValues(SERVER);
    expect(values.freelancer).toEqual({
      freeKm: "20",
      stepKm: "2",
      perStep: "10",
      roadFactorPct: "130",
      maxPerJob: "300",
    });
    expect(toTravelBody(values)).toEqual(SERVER);
  });

  it("accepts the defaults (both types off)", () => {
    expect(errorsOf(valid())).toEqual([]);
  });

  it("refuses a rate with a ₹0 maximum, with the server's sentence, on the maximum", () => {
    const v = valid();
    v.freelancer.maxPerJob = "0";
    expect(errorsOf(v)).toEqual([["freelancer.maxPerJob", MAX_NEEDED]]);
  });

  it("allows a ₹0 rate with a ₹0 maximum (off)", () => {
    const v = valid();
    v.employee.perStep = "0";
    v.employee.maxPerJob = "0";
    expect(errorsOf(v)).toEqual([]);
  });

  it.each([
    ["roadFactorPct", "99", "Between 100 % and 300 %"],
    ["roadFactorPct", "301", "Between 100 % and 300 %"],
    ["stepKm", "0", "Between 1 and 50 km"],
    ["stepKm", "51", "Between 1 and 50 km"],
    ["freeKm", "501", "Between 0 and 500 km"],
    ["freeKm", "1.5", "Enter a whole number of kilometres"],
    ["perStep", "10.5", "Enter a whole number of rupees"],
    ["perStep", "10001", "Up to ₹10,000"],
    ["maxPerJob", "100001", "Up to ₹1,00,000"],
    ["maxPerJob", "", "Enter a whole number of rupees"],
  ] as const)("refuses %s = %j", (field, value, message) => {
    const v = valid();
    v.freelancer[field] = value;
    expect(errorsOf(v)).toContainEqual([`freelancer.${field}`, message]);
  });

  it("previewRule is null until every box is a number", () => {
    const v = valid();
    expect(previewRule(v.freelancer)).toEqual(SERVER.freelancer);
    expect(previewRule({ ...v.freelancer, freeKm: "" })).toBeNull();
    expect(previewRule({ ...v.freelancer, stepKm: "0" })).toBeNull();
    expect(previewRule(undefined)).toBeNull();
  });
});
