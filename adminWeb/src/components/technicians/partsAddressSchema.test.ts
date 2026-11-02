import { describe, expect, it } from "vitest";
import {
  EMPTY_PARTS_ADDRESS,
  partsAddressSchema,
  toFormValues,
  toPartsAddressInput,
  type PartsAddressFormValues,
} from "./partsAddressSchema";

const ok: PartsAddressFormValues = {
  line: "12 MG Road",
  city: "Hyderabad",
  pincode: "500001",
  landmark: "",
  contactPhone: "",
};

const paths = (v: PartsAddressFormValues) => {
  const r = partsAddressSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("partsAddressSchema", () => {
  it("accepts a minimal address", () => {
    expect(paths(ok)).toEqual([]);
  });
  it("applies the server's bounds", () => {
    expect(paths({ ...ok, line: "ab" })).toEqual(["line"]);
    expect(paths({ ...ok, line: "x".repeat(241) })).toEqual(["line"]);
    expect(paths({ ...ok, city: "H" })).toEqual(["city"]);
    expect(paths({ ...ok, city: "x".repeat(81) })).toEqual(["city"]);
    expect(paths({ ...ok, landmark: "x".repeat(121) })).toEqual(["landmark"]);
  });
  it("needs a six-digit pincode", () => {
    expect(paths({ ...ok, pincode: "" })).toEqual(["pincode"]);
    expect(paths({ ...ok, pincode: "5000" })).toEqual(["pincode"]);
    expect(paths({ ...ok, pincode: "50000a" })).toEqual(["pincode"]);
  });
  it("lets the phone be blank, or a real number", () => {
    expect(paths({ ...ok, contactPhone: "98220 11223" })).toEqual([]);
    expect(paths({ ...ok, contactPhone: "+919822011223" })).toEqual([]);
    expect(paths({ ...ok, contactPhone: "123" })).toEqual(["contactPhone"]);
  });
});

describe("toPartsAddressInput", () => {
  it("omits blank optionals", () => {
    expect(toPartsAddressInput({ ...ok, line: "  12 MG Road " })).toEqual({
      line: "12 MG Road",
      city: "Hyderabad",
      pincode: "500001",
    });
  });
  it("sends the phone as E.164 and keeps a landmark", () => {
    expect(
      toPartsAddressInput({
        ...ok,
        landmark: " Opp. bus stand ",
        contactPhone: "98220 11223",
      })
    ).toEqual({
      line: "12 MG Road",
      city: "Hyderabad",
      pincode: "500001",
      landmark: "Opp. bus stand",
      contactPhone: "+919822011223",
    });
  });
});

describe("toFormValues", () => {
  it("is empty when nothing is saved", () => {
    expect(toFormValues(null)).toEqual(EMPTY_PARTS_ADDRESS);
    expect(toFormValues(undefined)).toEqual(EMPTY_PARTS_ADDRESS);
  });
  it("turns nulls into empty boxes", () => {
    expect(
      toFormValues({
        line: "12 MG Road",
        city: "Hyderabad",
        pincode: "500001",
        landmark: null,
        contactPhone: null,
        setAt: "2026-10-30T10:00:00Z",
      })
    ).toEqual(ok);
  });
});
