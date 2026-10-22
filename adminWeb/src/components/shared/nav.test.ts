import { describe, expect, it } from "vitest";
import { featureForPath } from "./nav";

/**
 * The rail and the route guard read their feature from the one table — these
 * pin the Franchisees entries, and the trailing-slash trap §8 calls out:
 * "/franchise/technicians" must NOT read as a franchisees path.
 */
describe("featureForPath", () => {
  it("gates the list and the detail on the view key", () => {
    expect(featureForPath("/franchisees")).toBe("franchisees.view");
    expect(featureForPath("/franchisees/abc")).toBe("franchisees.view");
  });

  it("does not mistake a sibling path for a franchisees one", () => {
    expect(featureForPath("/franchise/technicians")).not.toBe(
      "franchisees.view"
    );
    expect(featureForPath("/franchiseesque")).toBeUndefined();
  });
});