import { describe, expect, it } from "vitest";
import { istToday, presetRange, rangeProblem } from "./transactionPeriod";

describe("istToday", () => {
  it("reads the Indian date, not the UTC one", () => {
    // 31 Mar 20:00 UTC is already 1 Apr 01:30 in IST.
    expect(istToday(new Date("2026-03-31T20:00:00Z"))).toBe("2026-04-01");
    // 1 Apr 18:00 UTC is still 1 Apr 23:30 IST.
    expect(istToday(new Date("2026-04-01T18:00:00Z"))).toBe("2026-04-01");
  });
});

describe("presetRange", () => {
  const now = new Date("2026-10-30T06:00:00Z");
  it("this month runs from the 1st to today", () => {
    expect(presetRange("this_month", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-30",
    });
  });
  it("last month is the whole previous month", () => {
    expect(presetRange("last_month", now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
  it("last month crosses the year and handles February", () => {
    expect(presetRange("last_month", new Date("2026-01-15T06:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(presetRange("last_month", new Date("2024-03-10T06:00:00Z"))).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });
  it("last 3 months starts two months back", () => {
    expect(presetRange("last_3_months", now)).toEqual({
      from: "2026-08-01",
      to: "2026-10-30",
    });
    expect(presetRange("last_3_months", new Date("2026-02-05T06:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2026-02-05",
    });
  });
  it("this year runs from 1 January", () => {
    expect(presetRange("this_year", now)).toEqual({
      from: "2026-01-01",
      to: "2026-10-30",
    });
  });
  it("uses the IST month at the midnight edge", () => {
    // 30 Sep 19:00 UTC is 1 Oct 00:30 IST - already October.
    expect(presetRange("this_month", new Date("2026-09-30T19:00:00Z"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });
});

describe("rangeProblem", () => {
  it("accepts a normal range", () => {
    expect(rangeProblem({ from: "2026-01-01", to: "2026-01-31" })).toBeNull();
  });
  it("refuses an end before the start", () => {
    expect(rangeProblem({ from: "2026-02-01", to: "2026-01-31" })).toMatch(/before/);
  });
  it("refuses more than three years", () => {
    expect(rangeProblem({ from: "2020-01-01", to: "2026-01-01" })).toMatch(
      /three years/
    );
  });
  it("asks for both dates", () => {
    expect(rangeProblem({ from: "", to: "2026-01-01" })).toMatch(/both/);
  });
});
