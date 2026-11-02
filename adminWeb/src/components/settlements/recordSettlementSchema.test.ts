import { describe, expect, it } from "vitest";
import {
  isoDay,
  oldestAllowedDay,
  recordSettlementSchema,
} from "./recordSettlementSchema";

const today = new Date(2026, 9, 30); // 30 Oct 2026, local
const file = new File(["x"], "proof.png", { type: "image/png" });

const valid = {
  franchiseeId: "f1",
  amount: 1500,
  reason: "lease",
  note: "",
  transferredOn: "2026-10-29",
  utr: "",
  screenshot: file,
};

const messages = (
  input: unknown,
  needsFranchisee = true
): Record<string, string> => {
  const r = recordSettlementSchema({ needsFranchisee, today }).safeParse(input);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("recordSettlementSchema", () => {
  it("accepts a complete form", () => {
    expect(messages(valid)).toEqual({});
  });

  it("requires a franchisee for staff only", () => {
    expect(messages({ ...valid, franchiseeId: "" }).franchiseeId).toBeTruthy();
    expect(messages({ ...valid, franchiseeId: "" }, false)).toEqual({});
  });

  it("requires the screenshot", () => {
    expect(messages({ ...valid, screenshot: null }).screenshot).toBeTruthy();
  });

  it("requires a note when the reason is Other", () => {
    expect(messages({ ...valid, reason: "other" }).note).toBeTruthy();
    expect(messages({ ...valid, reason: "other", note: "Deposit" })).toEqual({});
  });

  it("refuses a future date and one over a year old", () => {
    expect(messages({ ...valid, transferredOn: "2026-10-31" }).transferredOn).toMatch(
      /future/
    );
    expect(messages({ ...valid, transferredOn: "2025-10-29" }).transferredOn).toMatch(
      /year/
    );
    expect(messages({ ...valid, transferredOn: "2025-10-30" })).toEqual({});
    expect(messages({ ...valid, transferredOn: "2026-10-30" })).toEqual({});
  });

  it("checks the UTR shape but allows it empty", () => {
    expect(messages({ ...valid, utr: "abc" }).utr).toBeTruthy();
    expect(messages({ ...valid, utr: "ABC 123 456" })).toEqual({});
  });

  it("refuses a zero amount and more than two decimals", () => {
    expect(messages({ ...valid, amount: 0 }).amount).toBeTruthy();
    expect(messages({ ...valid, amount: 10.123 }).amount).toBeTruthy();
    expect(messages({ ...valid, amount: 10.5 })).toEqual({});
  });
});

describe("day helpers", () => {
  it("formats local days and finds the oldest allowed", () => {
    expect(isoDay(today)).toBe("2026-10-30");
    expect(oldestAllowedDay(today)).toBe("2025-10-30");
  });
});
