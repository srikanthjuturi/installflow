import { describe, expect, it } from "vitest";
import type { DeliveryAddress } from "@/types/parts";
import {
  deliveryLines,
  deliverySourceLabel,
  deliverySourceNote,
  formatDeliveryAddress,
  isBaseOnly,
} from "./deliveryAddress";

const full: DeliveryAddress = {
  line: "12 MG Road",
  city: "Hyderabad",
  pincode: "500001",
  landmark: "Opp. bus stand",
  contactPhone: "+919822011223",
  source: "parts_address",
};

const baseOnly: DeliveryAddress = {
  line: null,
  city: null,
  pincode: "500030",
  landmark: null,
  contactPhone: null,
  source: "base",
};

describe("formatDeliveryAddress", () => {
  it("is multi-line with the phone last", () => {
    expect(formatDeliveryAddress(full)).toBe(
      "12 MG Road\nLandmark: Opp. bus stand\nHyderabad - 500001\nPhone: +91 98220 11223"
    );
  });
  it("drops what is missing", () => {
    expect(
      formatDeliveryAddress({ ...full, landmark: null, contactPhone: null })
    ).toBe("12 MG Road\nHyderabad - 500001");
  });
  it("is just the pincode for a base-only address", () => {
    expect(deliveryLines(baseOnly)).toEqual(["Pincode 500030"]);
    expect(formatDeliveryAddress(baseOnly)).toBe("Pincode 500030");
  });
});

describe("source labelling", () => {
  it("tells a saved address from a base area", () => {
    expect(isBaseOnly(full)).toBe(false);
    expect(isBaseOnly(baseOnly)).toBe(true);
    expect(deliverySourceLabel(full)).toBe("Parts address");
    expect(deliverySourceLabel(baseOnly)).toBe("Base area only");
  });
  it("only a base-only address carries the confirm-the-street note", () => {
    expect(deliverySourceNote(full)).toBeNull();
    expect(deliverySourceNote(baseOnly)).toBe(
      "Only the technician's base pincode is on file — confirm the street with them."
    );
  });
});
