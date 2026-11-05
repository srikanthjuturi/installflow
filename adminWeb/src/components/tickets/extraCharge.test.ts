import { describe, expect, it } from "vitest";
import {
  EXTRA_AMOUNT_MAX_PAISE,
  extraAmountToPaise,
  extraChargeIssues,
  extraChargePayload,
} from "./extraCharge";
import { istToday } from "@/utils/slots";
import { ticketSchema } from "./ticketSchema";

describe("extraAmountToPaise", () => {
  it("converts rupees to whole paise without drift", () => {
    expect(extraAmountToPaise("450")).toBe(45000);
    expect(extraAmountToPaise("3200.5")).toBe(320050);
    expect(extraAmountToPaise("0.07")).toBe(7);
    expect(extraAmountToPaise("1,250")).toBe(125000);
  });
  it("refuses what is not a plain amount", () => {
    expect(extraAmountToPaise("")).toBeNull();
    expect(extraAmountToPaise("abc")).toBeNull();
    expect(extraAmountToPaise("-5")).toBeNull();
    expect(extraAmountToPaise("1.234")).toBeNull();
  });
});

describe("extraChargeIssues", () => {
  it("is happy with neither", () => {
    expect(extraChargeIssues("", "")).toEqual([]);
    expect(extraChargeIssues(undefined, undefined)).toEqual([]);
    expect(extraChargeIssues("  ", " ")).toEqual([]);
  });
  it("is happy with both", () => {
    expect(extraChargeIssues("500", "Wall mount kit")).toEqual([]);
  });
  it("refuses half a pair, on the box that is missing", () => {
    expect(extraChargeIssues("500", "")[0]?.field).toBe("extraAmountNote");
    expect(extraChargeIssues("", "Wall mount kit")[0]?.field).toBe("extraAmount");
  });
  it("needs the amount above zero", () => {
    expect(extraChargeIssues("0", "x")[0]?.message).toMatch(/above zero/);
    expect(extraChargeIssues("0.00", "x")[0]?.field).toBe("extraAmount");
  });
  it("stops at the server's ceiling", () => {
    expect(extraChargeIssues("100000", "x")).toEqual([]);
    expect(EXTRA_AMOUNT_MAX_PAISE).toBe(10_000_000);
    expect(extraChargeIssues("100000.01", "x")[0]?.message).toMatch(/1,00,000/);
  });
  it("bounds the note at 120 characters", () => {
    expect(extraChargeIssues("5", "a".repeat(120))).toEqual([]);
    expect(extraChargeIssues("5", "a".repeat(121))[0]?.field).toBe(
      "extraAmountNote"
    );
  });
});

describe("extraChargePayload", () => {
  it("sends both fields or neither", () => {
    expect(extraChargePayload("450", " Wall mount ")).toEqual({
      extraAmountPaise: 45000,
      extraAmountNote: "Wall mount",
    });
    expect(extraChargePayload("", "")).toEqual({});
    expect(extraChargePayload("450", "")).toEqual({});
  });
});

describe("ticketSchema carries the rule", () => {
  // A complete, valid ticket - object-level refinements only run once every
  // field parses - with the extra charge varied.
  const valid = {
    vendorId: "v1",
    subcategoryId: "s1",
    modelId: "m1",
    serviceType: "Installation + Demo",
    description: "",
    serialNumber: "SN-1",
    customerName: "Asha Rao",
    customerPhone: "9876543210",
    customerAltPhone: "",
    address: "12 MG Road",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500001",
    latitude: null,
    longitude: null,
    expectedDate: istToday(),
    serviceLevelHours: 24,
    slotStart: "",
    slotEnd: "",
    isHighPriority: false,
    purchaseMode: "offline",
    purchasePlatformId: "",
    purchasePlatformName: "",
  };
  const issuesFor = (extraAmount: string, extraAmountNote: string) => {
    const r = ticketSchema.safeParse({ ...valid, extraAmount, extraAmountNote });
    if (r.success) return [];
    return r.error.issues.map((i) => i.path[0]);
  };
  it("accepts the base ticket", () => {
    expect(ticketSchema.safeParse(valid).success).toBe(true);
  });

  it("adds no extra-charge issue for neither or both", () => {
    expect(issuesFor("", "")).toEqual([]);
    expect(issuesFor("500", "Wall mount kit")).toEqual([]);
  });
  it("flags half a pair", () => {
    expect(issuesFor("500", "")).toContain("extraAmountNote");
    expect(issuesFor("", "Wall mount kit")).toContain("extraAmount");
  });
});
