import { describe, expect, it } from "vitest";
import {
  TRANSACTIONS_PATH,
  ticketPathFor,
  transactionSurfaceOf,
} from "./surface";
import {
  SURFACE_CAPS,
  amountColumns,
  balanceWording,
} from "@/types/transaction";

describe("transactionSurfaceOf", () => {
  it("ranks superadmin, franchise, vendor, then the company console", () => {
    expect(
      transactionSurfaceOf({ superadmin: true, franchise: true, portal: true })
    ).toBe("superadmin");
    expect(
      transactionSurfaceOf({ superadmin: false, franchise: true, portal: true })
    ).toBe("franchise");
    expect(
      transactionSurfaceOf({ superadmin: false, franchise: false, portal: true })
    ).toBe("vendor");
    expect(
      transactionSurfaceOf({ superadmin: false, franchise: false, portal: false })
    ).toBe("company");
  });
});

describe("TRANSACTIONS_PATH", () => {
  it("gives every surface its own URL", () => {
    const paths = Object.values(TRANSACTIONS_PATH);
    expect(new Set(paths).size).toBe(paths.length);
    expect(TRANSACTIONS_PATH.company).toBe("/transactions");
  });
});

describe("ticketPathFor", () => {
  it("links inside each shell, and nowhere for the superadmin", () => {
    expect(ticketPathFor("company", "t1")).toBe("/tickets/t1");
    expect(ticketPathFor("vendor", "t1")).toBe("/portal/tickets/t1");
    expect(ticketPathFor("franchise", "t1")).toBe("/franchise/tickets/t1");
    expect(ticketPathFor("superadmin", "t1")).toBeNull();
  });
});

describe("amountColumns", () => {
  it("puts a debit in the debit column only", () => {
    expect(amountColumns({ effect: "debit", amountPaise: 500 })).toEqual({
      debitPaise: 500,
      creditPaise: null,
    });
  });
  it("puts a credit in the credit column only", () => {
    expect(amountColumns({ effect: "credit", amountPaise: 500 })).toEqual({
      debitPaise: null,
      creditPaise: 500,
    });
  });
});

describe("balanceWording", () => {
  it("says who owes whom, in plain words", () => {
    expect(balanceWording(1200)).toEqual({ tone: "owes", phrase: "owes the company" });
    expect(balanceWording(-1)).toEqual({
      tone: "owed",
      phrase: "is owed by the company",
    });
    expect(balanceWording(0)).toEqual({ tone: "settled", phrase: "settled" });
  });
});

describe("SURFACE_CAPS", () => {
  it("shows email controls only to the company and the platform", () => {
    expect(SURFACE_CAPS.superadmin.email).toBe(true);
    expect(SURFACE_CAPS.company.email).toBe(true);
    expect(SURFACE_CAPS.vendor.email).toBe(false);
    expect(SURFACE_CAPS.franchise.email).toBe(false);
  });
  it("hides the vendor's party filter - it is always itself", () => {
    expect(SURFACE_CAPS.vendor.partyFilter).toBe(false);
  });
  it("offers the roll-up and the company filter to the superadmin alone", () => {
    expect(SURFACE_CAPS.superadmin.rollup).toBe(true);
    expect(SURFACE_CAPS.superadmin.companyFilter).toBe(true);
    for (const s of ["company", "vendor", "franchise"] as const) {
      expect(SURFACE_CAPS[s].rollup).toBe(false);
      expect(SURFACE_CAPS[s].companyFilter).toBe(false);
    }
  });
});
