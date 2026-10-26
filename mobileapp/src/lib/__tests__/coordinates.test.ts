import { metresBetween, metresLabel } from "../coordinates";

const HYDERABAD = { lat: 17.385, lon: 78.4867 };
const BENGALURU = { lat: 12.9716, lon: 77.5946 };

// What api/tests/unit/test_coordinates.py's identical haversine computed for
// this pair. The two implementations must agree — the server enforces the
// proof-distance rule, the app only tries to anticipate it before the shutter
// fires — so a disagreement here means one of them is wrong.
const PYTHON_HYDERABAD_TO_BENGALURU_M = 499_993.9315170922;

describe("metresBetween", () => {
  it("is zero for the same point", () => {
    expect(metresBetween(HYDERABAD.lat, HYDERABAD.lon, HYDERABAD.lat, HYDERABAD.lon)).toBe(0);
  });

  it("is symmetric", () => {
    const forward = metresBetween(HYDERABAD.lat, HYDERABAD.lon, BENGALURU.lat, BENGALURU.lon);
    const backward = metresBetween(BENGALURU.lat, BENGALURU.lon, HYDERABAD.lat, HYDERABAD.lon);
    expect(forward).toBeCloseTo(backward, 6);
  });

  it("puts Hyderabad to Bengaluru at about 500 km, within 1%", () => {
    const distance = metresBetween(HYDERABAD.lat, HYDERABAD.lon, BENGALURU.lat, BENGALURU.lon);
    expect(Math.abs(distance - 500_000)).toBeLessThan(500_000 * 0.01);
  });

  it("agrees with the Python implementation to within 1 metre", () => {
    const distance = metresBetween(HYDERABAD.lat, HYDERABAD.lon, BENGALURU.lat, BENGALURU.lon);
    expect(Math.abs(distance - PYTHON_HYDERABAD_TO_BENGALURU_M)).toBeLessThan(1);
  });

  it("puts one degree of latitude at about 111,195 m, within 0.5%", () => {
    const distance = metresBetween(0, 78, 1, 78);
    expect(Math.abs(distance - 111_195)).toBeLessThan(111_195 * 0.005);
  });
});

describe("metresLabel", () => {
  it("formats sub-kilometre distances in metres", () => {
    expect(metresLabel(420)).toBe("420 m");
  });

  it("formats kilometre-plus distances in kilometres", () => {
    expect(metresLabel(4200)).toBe("4.2 km");
  });
});
