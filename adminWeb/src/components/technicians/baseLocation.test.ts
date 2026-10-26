import { describe, expect, it } from "vitest";
import {
  BASE_SOURCE_CHIP,
  BASE_SOURCE_LABEL,
  baseChip,
  describeBase,
  formatLatLng,
  inIndia,
  roundCoord,
  setByLine,
  toBaseBody,
  validateBaseForm,
} from "./baseLocation";

describe("inIndia", () => {
  it("includes the bounds", () => {
    expect(inIndia(6, 68)).toBe(true);
    expect(inIndia(38, 98)).toBe(true);
    expect(inIndia(6, 98)).toBe(true);
    expect(inIndia(38, 68)).toBe(true);
  });
  it("excludes a hair outside", () => {
    expect(inIndia(5.99, 80)).toBe(false);
    expect(inIndia(20, 98.01)).toBe(false);
    expect(inIndia(38.01, 80)).toBe(false);
    expect(inIndia(20, 67.99)).toBe(false);
  });
  it("is false for NaN and Infinity", () => {
    expect(inIndia(Number.NaN, 78)).toBe(false);
    expect(inIndia(17, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("rounding and formatting", () => {
  it("roundCoord keeps 5 decimal places", () => {
    expect(roundCoord(17.4401234)).toBe(17.44012);
    expect(roundCoord(78.34896)).toBe(78.34896);
  });
  it("formatLatLng prints the rounded pair", () => {
    expect(formatLatLng(17.4401234, 78.3489)).toBe("17.44012, 78.3489");
  });
});

describe("describeBase", () => {
  it.each([
    [{ source: "pincode", pincode: "500049" }, "Pincode 500049 (area centre)"],
    [{ source: "map", pincode: null }, "Pin on the map"],
    [{ source: "gps", pincode: null }, "Phone location"],
    [{ source: "manual", pincode: null }, "Typed coordinates"],
  ] as const)("%j", (base, expected) => {
    expect(describeBase(base)).toBe(expected);
  });

  it("a pincode base with no code still reads sensibly", () => {
    expect(describeBase({ source: "pincode", pincode: null })).toBe(
      "Pincode (area centre)"
    );
  });
});

describe("source chips (R9)", () => {
  it("pincode / gps / map / manual read Pincode / GPS / Map / Set by admin", () => {
    expect(BASE_SOURCE_CHIP.pincode.label).toBe("Pincode");
    expect(BASE_SOURCE_CHIP.gps.label).toBe("GPS");
    expect(BASE_SOURCE_CHIP.map.label).toBe("Map");
    expect(BASE_SOURCE_CHIP.manual.label).toBe("Set by admin");
    expect(BASE_SOURCE_LABEL.manual).toBe("Set by admin");
  });

  it("every chip carries a class", () => {
    for (const chip of Object.values(BASE_SOURCE_CHIP)) {
      expect(chip.class).toMatch(/^bg-\S+ text-\S+$/);
    }
  });

  it("an unknown source falls back to a neutral chip with the raw word", () => {
    expect(baseChip("satellite")).toEqual({
      label: "satellite",
      class: "bg-surface-3 text-ink-2",
    });
    // An inherited Object.prototype member must not come back as a chip.
    expect(baseChip("constructor").label).toBe("constructor");
  });

  it("a known source resolves through baseChip", () => {
    expect(baseChip("gps")).toBe(BASE_SOURCE_CHIP.gps);
  });
});

describe("toBaseBody", () => {
  const values = {
    pincode: "500049",
    latitude: "17.4401234",
    longitude: "78.3489012",
  };

  it("pincode mode sends the pincode only", () => {
    expect(toBaseBody({ ...values, mode: "pincode" })).toEqual({
      pincode: "500049",
    });
  });

  it("map mode sends the rounded point and source map", () => {
    expect(toBaseBody({ ...values, mode: "map" })).toEqual({
      latitude: 17.44012,
      longitude: 78.3489,
      source: "map",
    });
  });

  it("manual mode sends source manual", () => {
    expect(toBaseBody({ ...values, mode: "manual" })).toMatchObject({
      source: "manual",
    });
  });

  it("trims the pincode", () => {
    expect(
      toBaseBody({ ...values, mode: "pincode", pincode: " 500049 " })
    ).toEqual({ pincode: "500049" });
  });
});

describe("validateBaseForm", () => {
  const ok = {
    mode: "map" as const,
    pincode: "",
    latitude: "17.44",
    longitude: "78.35",
  };

  it("accepts a point inside India", () => {
    expect(validateBaseForm(ok)).toEqual({});
  });

  it("refuses a point outside India on the latitude, in words", () => {
    expect(validateBaseForm({ ...ok, latitude: "51.5", longitude: "-0.12" })).toEqual({
      latitude: "That point is outside India.",
    });
  });

  it("asks for a missing coordinate by name", () => {
    expect(validateBaseForm({ ...ok, latitude: "" })).toEqual({
      latitude: "Enter a latitude",
    });
    expect(validateBaseForm({ ...ok, mode: "manual", longitude: "abc" })).toEqual({
      longitude: "Enter a longitude",
    });
  });

  it("pincode mode needs six digits and ignores the point", () => {
    const p = { ...ok, mode: "pincode" as const, latitude: "", longitude: "" };
    expect(validateBaseForm({ ...p, pincode: "500049" })).toEqual({});
    expect(validateBaseForm({ ...p, pincode: "5000" })).toEqual({
      pincode: "Enter a 6-digit pincode",
    });
    expect(validateBaseForm({ ...p, pincode: "" })).toEqual({
      pincode: "Enter a 6-digit pincode",
    });
  });

  it("map mode ignores whatever is in the pincode box", () => {
    expect(validateBaseForm({ ...ok, pincode: "nope" })).toEqual({});
  });
});

describe("setByLine (R9)", () => {
  const when = "12 Oct, 4:30 PM";

  it("a self-set base says so", () => {
    expect(setByLine({ setBySelf: true }, when)).toBe(
      "Set by the technician · 12 Oct, 4:30 PM"
    );
  });

  it("an admin-set base names the admin and the role", () => {
    expect(
      setByLine(
        { setBySelf: false, setByName: "Meena R", setByRole: "Franchisee Admin" },
        when
      )
    ).toBe("Set by Meena R (Franchisee Admin) · 12 Oct, 4:30 PM");
  });

  it("a name without a role omits the brackets", () => {
    expect(setByLine({ setBySelf: false, setByName: "Meena R" }, when)).toBe(
      "Set by Meena R · 12 Oct, 4:30 PM"
    );
  });

  it("a deleted user, or a viewer who cannot see names, still says when", () => {
    expect(setByLine({ setBySelf: false, setByName: null }, when)).toBe(
      "Set · 12 Oct, 4:30 PM"
    );
    expect(setByLine({ setBySelf: null }, when)).toBe("Set · 12 Oct, 4:30 PM");
  });
});
