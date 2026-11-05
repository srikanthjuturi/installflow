import { describe, expect, it } from "vitest";
import { ticketSchema } from "./ticketSchema";

/** Only the `locality` issues — the rest of the ticket is not under test here. */
function localityIssues(locality: unknown) {
  const result = ticketSchema.safeParse({ locality });
  return result.success
    ? []
    : result.error.issues.filter((i) => i.path[0] === "locality");
}

describe("ticketSchema.locality (Epic 7)", () => {
  it("is optional", () => {
    expect(localityIssues(undefined)).toEqual([]);
    expect(localityIssues("")).toEqual([]);
  });

  it("accepts any free text up to 80 characters", () => {
    expect(localityIssues("Moazzampura")).toEqual([]);
    expect(localityIssues("x".repeat(80))).toEqual([]);
  });

  it("trims before measuring", () => {
    expect(localityIssues(`  ${"x".repeat(80)}  `)).toEqual([]);
  });

  it("refuses more than 80 characters", () => {
    const issues = localityIssues("x".repeat(81));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("Local area can be at most 80 characters");
  });
});
