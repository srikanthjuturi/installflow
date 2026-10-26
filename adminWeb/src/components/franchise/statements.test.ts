import { describe, expect, it } from "vitest";
import {
  defaultStatementMonth,
  isStatementMonth,
  statementFileName,
  statementMonths,
} from "./statements";

/**
 * Task 09 §6 — the month vocabulary's IST edges, and the file name the console
 * puts on the download (the server's Content-Disposition is not CORS-exposed).
 */
describe("statementMonths", () => {
  it("starts at October 2026 for 2026-09-30T19:00Z — that is 01:30 IST on 1 Oct", () => {
    const months = statementMonths(new Date("2026-09-30T19:00:00Z"));
    expect(months[0].value).toBe("2026-10");
    expect(months[0].isCurrent).toBe(true);
    expect(months[0].label).toContain("(so far)");
  });

  it("is still September for 2026-09-30T18:00Z — IST has not crossed midnight yet", () => {
    const months = statementMonths(new Date("2026-09-30T18:00:00Z"));
    expect(months[0].value).toBe("2026-09");
    expect(months[0].isCurrent).toBe(true);
  });

  it("offers twelve months, newest first, in YYYY-MM", () => {
    const months = statementMonths(new Date("2026-01-05T10:00:00Z"));
    expect(months).toHaveLength(12);
    expect(months[0].isCurrent).toBe(true);
    for (const m of months) {
      expect(m.value).toMatch(/^\d{4}-\d{2}$/);
      expect(m.value.slice(5)).toMatch(/^(0[1-9]|1[0-2])$/);
    }
    // Newest first means strictly decreasing pairs.
    for (let i = 1; i < months.length; i++) {
      expect(months[i].value < months[i - 1].value).toBe(true);
    }
  });

  it("rolls the year over — January's last entry is the previous December", () => {
    const months = statementMonths(new Date("2026-01-05T10:00:00Z"));
    expect(months[0].value).toBe("2026-01");
    expect(months[11].value).toBe("2025-02");
  });
});

describe("defaultStatementMonth", () => {
  it("is the PREVIOUS IST month — payroll runs after a month closes", () => {
    expect(defaultStatementMonth(new Date("2026-09-30T19:00:00Z")).value).toBe(
      "2026-09"
    );
    expect(defaultStatementMonth(new Date("2026-01-05T10:00:00Z")).value).toBe(
      "2025-12"
    );
    expect(defaultStatementMonth(new Date("2026-01-05T10:00:00Z")).isCurrent).toBe(
      false
    );
  });
});

describe("statementFileName", () => {
  it("slugs company and franchisee and keeps the code and month", () => {
    expect(
      statementFileName({
        company: "Acme Appliances",
        franchisee: "SkyFix Services",
        code: "TCH-4033",
        month: "2026-09",
      })
    ).toBe("acme-appliances-skyfix-services-tch-4033-2026-09.csv");
  });

  it("never contains spaces or slashes, whatever it was handed", () => {
    const name = statementFileName({
      company: "A B / C Co",
      franchisee: "D & E",
      code: "TCH 1",
      month: "2026-09",
    });
    expect(name).not.toMatch(/[\s/]/);
    expect(name).toMatch(/-2026-09\.csv$/);
  });
});

describe("isStatementMonth", () => {
  it("accepts a real month and rejects the ones a hand-edited URL produces", () => {
    expect(isStatementMonth("2026-09")).toBe(true);
    expect(isStatementMonth("2026-13")).toBe(false);
    expect(isStatementMonth("2026-1")).toBe(false);
    expect(isStatementMonth("")).toBe(false);
    expect(isStatementMonth(null)).toBe(false);
    expect(isStatementMonth(undefined)).toBe(false);
  });
});