import { describe, expect, it } from "vitest";
import {
  applyTransactionPatch,
  readTransactionState,
  toQuery,
} from "./useTransactionFilters";

const NOW = new Date("2026-10-30T06:00:00Z");
const ID = "3f1c2b4a-9d1e-4c5f-8a7b-0123456789ab";

describe("readTransactionState", () => {
  it("defaults to this month on the documents tab", () => {
    const s = readTransactionState(new URLSearchParams(""), NOW);
    expect(s.tab).toBe("documents");
    expect(s.preset).toBe("this_month");
    expect(s.range).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(s.page).toBe(1);
  });

  it("reads a preset and the filters", () => {
    const s = readTransactionState(
      new URLSearchParams(`p=last_month&type=debit_note&kind=vendor&party=${ID}&q=RGT`),
      NOW
    );
    expect(s.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(toQuery(s)).toMatchObject({
      docType: "debit_note",
      partyKind: "vendor",
      partyId: ID,
      search: "RGT",
    });
  });

  it("reads a custom range, and falls back when it has no dates", () => {
    expect(
      readTransactionState(new URLSearchParams("p=custom&from=2026-01-05&to=2026-02-10"), NOW)
        .range
    ).toEqual({ from: "2026-01-05", to: "2026-02-10" });
    expect(readTransactionState(new URLSearchParams("p=custom"), NOW).preset).toBe(
      "this_month"
    );
  });

  it("drops values it does not recognise rather than sending them", () => {
    const s = readTransactionState(
      new URLSearchParams("type=bogus&kind=x&party=not-a-uuid&company=nope&limit=7&page=-3"),
      NOW
    );
    expect(s.docType).toBeUndefined();
    expect(s.partyKind).toBeUndefined();
    expect(s.partyId).toBeUndefined();
    expect(s.companyId).toBeUndefined();
    expect(s.limit).toBe(20);
    expect(s.page).toBe(1);
  });
});

describe("applyTransactionPatch", () => {
  it("never writes the defaults", () => {
    const next = applyTransactionPatch(new URLSearchParams("p=last_month"), {
      p: "this_month",
    });
    expect(next.toString()).toBe("");
  });

  it("returns to page 1 when a filter changes, but not for paging or the tab", () => {
    const base = new URLSearchParams("page=4");
    expect(applyTransactionPatch(base, { type: "receipt" }).get("page")).toBeNull();
    expect(applyTransactionPatch(base, { limit: "50" }).get("page")).toBe("4");
    expect(applyTransactionPatch(base, { tab: "statement" }).get("page")).toBe("4");
  });

  it("clears custom dates when a preset is chosen", () => {
    const next = applyTransactionPatch(
      new URLSearchParams("p=custom&from=2026-01-01&to=2026-01-31"),
      { p: "this_year" }
    );
    expect(next.get("from")).toBeNull();
    expect(next.get("to")).toBeNull();
    expect(next.get("p")).toBe("this_year");
  });

  it("removes a key given an empty value", () => {
    expect(
      applyTransactionPatch(new URLSearchParams("kind=vendor"), { kind: "" }).has("kind")
    ).toBe(false);
  });
});
