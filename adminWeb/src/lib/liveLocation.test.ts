import { describe, expect, it } from "vitest";
import type { LiveLocation } from "@/types/liveLocation";
import {
  accuracyText,
  ageSpan,
  distanceLabel,
  distanceToCustomer,
  freshnessText,
  haversineKm,
  isLiveStatus,
  placeText,
  staleText,
  summaryCounts,
  updatedText,
} from "./liveLocation";

const base: LiveLocation = {
  ticketId: "t1",
  ticketCode: "TKT-1",
  status: "In Progress",
  technicianId: "u1",
  technicianName: "Ravi",
  latitude: 17.385,
  longitude: 78.4867,
  accuracyM: 25,
  recordedAt: "2026-10-30T10:00:00Z",
  receivedAt: "2026-10-30T10:00:01Z",
  ageSeconds: 12,
  stale: false,
  customerLatitude: null,
  customerLongitude: null,
  city: "Hyderabad",
  pincode: "500001",
  companyId: "c1",
};

describe("isLiveStatus", () => {
  it.each(["Assigned", "In Progress", "Awaiting Part"])("%s is live", (s) =>
    expect(isLiveStatus(s)).toBe(true)
  );
  it.each([
    "New",
    "Slot Pending",
    "Awaiting Customer",
    "AI Review",
    "Escalated",
    "Closed",
    "Force-Closed",
    "Cancelled",
    "",
  ])("%s is not", (s) => expect(isLiveStatus(s)).toBe(false));
  it("is false for null and undefined", () => {
    expect(isLiveStatus(null)).toBe(false);
    expect(isLiveStatus(undefined)).toBe(false);
  });
});

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: 17, lng: 78 }, { lat: 17, lng: 78 })).toBe(0);
  });
  it("measures a degree of latitude as about 111 km", () => {
    const d = haversineKm({ lat: 17, lng: 78 }, { lat: 18, lng: 78 });
    expect(d).toBeGreaterThan(110.9);
    expect(d).toBeLessThan(111.5);
  });
  it("is symmetric", () => {
    const a = { lat: 17.385, lng: 78.4867 };
    const b = { lat: 12.9716, lng: 77.5946 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
  it("puts Hyderabad and Bengaluru about 500 km apart", () => {
    const d = haversineKm(
      { lat: 17.385, lng: 78.4867 },
      { lat: 12.9716, lng: 77.5946 }
    );
    expect(d).toBeGreaterThan(495);
    expect(d).toBeLessThan(515);
  });
});

describe("distanceLabel", () => {
  it("uses metres under a kilometre", () => {
    expect(distanceLabel(0)).toBe("0 m");
    expect(distanceLabel(0.85)).toBe("850 m");
    expect(distanceLabel(0.9996)).toBe("1000 m");
  });
  it("uses one decimal of kilometres under 100", () => {
    expect(distanceLabel(1)).toBe("1.0 km");
    expect(distanceLabel(12.34)).toBe("12.3 km");
  });
  it("rounds to whole kilometres from 100", () => {
    expect(distanceLabel(134.6)).toBe("135 km");
  });
  it("refuses nonsense", () => {
    expect(distanceLabel(NaN)).toBe("—");
    expect(distanceLabel(-1)).toBe("—");
  });
});

describe("distanceToCustomer", () => {
  it("is null without a customer pick", () => {
    expect(distanceToCustomer(base)).toBeNull();
    expect(distanceToCustomer({ ...base, customerLatitude: 17 })).toBeNull();
  });
  it("labels the straight line when the job has a pick", () => {
    expect(
      distanceToCustomer({
        ...base,
        latitude: 17,
        longitude: 78,
        customerLatitude: 18,
        customerLongitude: 78,
      })
    ).toBe("111 km");
  });
});

describe("age wording", () => {
  it("picks the unit", () => {
    expect(ageSpan(0)).toBe("0 s");
    expect(ageSpan(59)).toBe("59 s");
    expect(ageSpan(60)).toBe("1 min");
    expect(ageSpan(5 * 60 + 59)).toBe("5 min");
    expect(ageSpan(3600)).toBe("1 h");
    expect(ageSpan(26 * 3600)).toBe("1 d");
    expect(ageSpan(-5)).toBe("0 s");
  });
  it("says just now for a fresh point", () => {
    expect(updatedText(2)).toBe("Updated just now");
    expect(updatedText(12)).toBe("Updated 12 s ago");
    expect(updatedText(130)).toBe("Updated 2 min ago");
  });
  it("never lets a stale point read as current", () => {
    expect(staleText(600)).toBe(
      "Last seen 10 min ago — their phone is not reporting"
    );
    expect(freshnessText({ stale: true, ageSeconds: 600 })).toMatch(
      /not reporting/
    );
    expect(freshnessText({ stale: true, ageSeconds: 600 })).not.toMatch(
      /^Updated/
    );
    expect(freshnessText({ stale: false, ageSeconds: 12 })).toBe(
      "Updated 12 s ago"
    );
  });
});

describe("placeText / accuracyText / summaryCounts", () => {
  it("joins what exists", () => {
    expect(placeText({ city: "Hyderabad", pincode: "500001" })).toBe(
      "Hyderabad 500001"
    );
    expect(placeText({ city: null, pincode: "500001" })).toBe("500001");
    expect(placeText({ city: "Pune", pincode: null })).toBe("Pune");
    expect(placeText({ city: null, pincode: null })).toBe("—");
  });
  it("only draws an accuracy the phone gave", () => {
    expect(accuracyText(25.4)).toBe("±25 m");
    expect(accuracyText(null)).toBeNull();
    expect(accuracyText(0)).toBeNull();
  });
  it("counts reporting and not-reporting", () => {
    expect(
      summaryCounts([{ stale: false }, { stale: true }, { stale: false }])
    ).toEqual({ live: 2, stale: 1 });
    expect(summaryCounts([])).toEqual({ live: 0, stale: 0 });
  });
});
