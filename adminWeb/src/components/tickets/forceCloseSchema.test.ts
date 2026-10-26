import { describe, expect, it } from "vitest";
import { forceCloseSchema } from "./forceCloseSchema";

const base = () => ({
  reason: "Customer unreachable after multiple attempts",
  notes: "Rang four times over two days, no answer.",
  attachments: [new File(["x"], "call-log.jpg", { type: "image/jpeg" })],
  technicianPayout: "",
  vendorCharge: "",
  travelAllowance: "",
});

const messages = (travelMaxPaise: number | null, travelAllowance: string) => {
  const r = forceCloseSchema(travelMaxPaise).safeParse({
    ...base(),
    travelAllowance,
  });
  return r.success
    ? []
    : r.error.issues.map((i) => [i.path.join("."), i.message]);
};

describe("forceCloseSchema — the travel allowance field", () => {
  it("passes at the maximum exactly", () => {
    expect(messages(30000, "300")).toEqual([]);
  });

  it("refuses ₹1 over the maximum, naming the maximum", () => {
    expect(messages(30000, "301")).toEqual([
      ["travelAllowance", "At most ₹300"],
    ]);
  });

  it("an empty field passes — it means pay nothing", () => {
    expect(messages(30000, "")).toEqual([]);
  });

  it("allows ₹0", () => {
    expect(messages(30000, "0")).toEqual([]);
  });

  it("refuses non-numeric input, without also claiming it is over the cap", () => {
    expect(messages(30000, "abc")).toEqual([
      ["travelAllowance", "Enter a whole number of rupees"],
    ]);
    expect(messages(30000, "12.5")).toEqual([
      ["travelAllowance", "Enter a whole number of rupees"],
    ]);
  });

  it("with no ceiling (field not shown) it is unconstrained but still numeric", () => {
    expect(messages(null, "999999")).toEqual([]);
    expect(messages(null, "")).toEqual([]);
    expect(messages(null, "abc")).toEqual([
      ["travelAllowance", "Enter a whole number of rupees"],
    ]);
  });

  it("a Rs.40 default under a Rs.300 maximum passes", () => {
    expect(messages(30000, "40")).toEqual([]);
  });
});

describe("forceCloseSchema — the pre-existing rules still hold", () => {
  it("requires a reason, a long-enough note and an attachment", () => {
    const r = forceCloseSchema(null).safeParse({
      ...base(),
      reason: "",
      notes: "short",
      attachments: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual([
        "attachments",
        "notes",
        "reason",
      ]);
    }
  });
});
