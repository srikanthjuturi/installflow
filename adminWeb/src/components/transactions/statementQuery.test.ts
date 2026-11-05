import { describe, expect, it } from "vitest";
import { resolveStatementQuery } from "./statementQuery";

const range = { from: "2026-10-01", to: "2026-10-30" };
const ID = "3f1c2b4a-9d1e-4c5f-8a7b-0123456789ab";
const CO = "7a1c2b4a-9d1e-4c5f-8a7b-0123456789cd";

describe("resolveStatementQuery", () => {
  it("asks the superadmin for a company first", () => {
    const r = resolveStatementQuery({
      surface: "superadmin",
      state: { range, statementKind: "platform" },
    });
    expect(r.query).toBeNull();
    expect(r.missing).toBe("Choose a company.");
  });

  it("needs no party for the platform", () => {
    const r = resolveStatementQuery({
      surface: "superadmin",
      state: { range, companyId: CO, statementKind: "platform" },
    });
    expect(r.query).toEqual({
      partyKind: "platform",
      partyId: null,
      from: range.from,
      to: range.to,
      companyId: CO,
    });
  });

  it("asks for the party of any other kind", () => {
    const r = resolveStatementQuery({
      surface: "company",
      state: { range, statementKind: "vendor" },
    });
    expect(r.query).toBeNull();
    expect(r.missing).toMatch(/vendor/);
  });

  it("never sends a company id from a company console", () => {
    const r = resolveStatementQuery({
      surface: "company",
      state: { range, companyId: CO, statementKind: "vendor", statementParty: ID },
    });
    expect(r.query).toEqual({
      partyKind: "vendor",
      partyId: ID,
      from: range.from,
      to: range.to,
    });
  });

  it("fixes a vendor's statement to its own party", () => {
    const r = resolveStatementQuery({
      surface: "vendor",
      state: { range, statementKind: "technician", statementParty: "ignored" },
      ownPartyId: ID,
    });
    expect(r.query).toMatchObject({ partyKind: "vendor", partyId: ID });
  });

  it("waits, without a complaint, while a fixed party is still loading", () => {
    const r = resolveStatementQuery({
      surface: "franchise",
      state: { range },
      ownPartyId: null,
    });
    expect(r.query).toBeNull();
    expect(r.missing).toBeNull();
  });

  it("refuses a bad period before asking the server", () => {
    const r = resolveStatementQuery({
      surface: "company",
      state: {
        range: { from: "2026-10-30", to: "2026-10-01" },
        statementKind: "platform",
      },
    });
    expect(r.query).toBeNull();
    expect(r.missing).toMatch(/before/);
  });
});
