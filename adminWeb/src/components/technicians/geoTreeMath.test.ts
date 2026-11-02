import { describe, expect, it } from "vitest";
import {
  MAX_COVERAGE_PINCODES,
  addCodes,
  matchesName,
  nextNodeChecked,
  nodeState,
  overBy,
  removeCodes,
  selectionKey,
  toggleCode,
} from "./geoTreeMath";

const full = () =>
  Array.from({ length: MAX_COVERAGE_PINCODES }, (_, i) => String(100000 + i));

describe("nodeState", () => {
  it("is unchecked at zero selected", () => {
    expect(nodeState(0, 10)).toBe("unchecked");
  });
  it("is mixed when some are selected", () => {
    expect(nodeState(1, 10)).toBe("mixed");
    expect(nodeState(9, 10)).toBe("mixed");
  });
  it("is checked when all are selected", () => {
    expect(nodeState(10, 10)).toBe("checked");
    expect(nodeState(11, 10)).toBe("checked");
  });
  it("never reads as ticked when there is nothing to pick", () => {
    expect(nodeState(0, 0)).toBe("unchecked");
    expect(nodeState(3, 0)).toBe("unchecked");
  });
  it("ignores a negative count", () => {
    expect(nodeState(-1, 5)).toBe("unchecked");
  });
});

describe("nextNodeChecked", () => {
  it("ticks an unchecked or half-ticked node, un-ticks a ticked one", () => {
    expect(nextNodeChecked("unchecked")).toBe(true);
    expect(nextNodeChecked("mixed")).toBe(true);
    expect(nextNodeChecked("checked")).toBe(false);
  });
});

describe("addCodes", () => {
  it("appends new codes after the existing ones", () => {
    const r = addCodes(["500001"], ["500002", "500003"]);
    expect(r.next).toEqual(["500001", "500002", "500003"]);
    expect(r.added).toBe(2);
    expect(r.overLimit).toBe(false);
  });
  it("does not duplicate codes already selected or repeated in the input", () => {
    const r = addCodes(["500001"], ["500001", "500002", "500002"]);
    expect(r.next).toEqual(["500001", "500002"]);
    expect(r.added).toBe(1);
  });
  it("is a no-op for an empty list", () => {
    const sel = ["500001"];
    const r = addCodes(sel, []);
    expect(r.next).toEqual(sel);
    expect(r.next).not.toBe(sel);
    expect(r.added).toBe(0);
  });
  it("allows exactly the cap", () => {
    const r = addCodes([], full());
    expect(r.overLimit).toBe(false);
    expect(r.next).toHaveLength(MAX_COVERAGE_PINCODES);
  });
  it("refuses wholesale past the cap and leaves the selection alone", () => {
    const have = full();
    const r = addCodes(have, ["999999"]);
    expect(r.overLimit).toBe(true);
    expect(r.wouldBe).toBe(MAX_COVERAGE_PINCODES + 1);
    expect(r.next).toEqual(have);
    expect(r.added).toBe(0);
  });
  it("counts only genuinely new codes against the cap", () => {
    const have = full();
    expect(addCodes(have, [have[0], have[1]]).overLimit).toBe(false);
  });
  it("honours a custom cap", () => {
    expect(addCodes(["1"], ["2", "3"], 2).overLimit).toBe(true);
    expect(addCodes(["1"], ["2"], 2).overLimit).toBe(false);
  });
});

describe("removeCodes", () => {
  it("removes only the given codes, keeping order", () => {
    expect(removeCodes(["a", "b", "c", "d"], ["b", "d"])).toEqual(["a", "c"]);
  });
  it("ignores codes that are not selected", () => {
    expect(removeCodes(["a"], ["z"])).toEqual(["a"]);
  });
  it("handles empty inputs", () => {
    expect(removeCodes([], ["a"])).toEqual([]);
    expect(removeCodes(["a"], [])).toEqual(["a"]);
  });
});

describe("toggleCode", () => {
  it("adds a code that is not selected", () => {
    expect(toggleCode(["500001"], "500002").next).toEqual(["500001", "500002"]);
  });
  it("removes a code that is selected", () => {
    const r = toggleCode(["500001", "500002"], "500001");
    expect(r.next).toEqual(["500002"]);
    expect(r.overLimit).toBe(false);
  });
  it("refuses to add past the cap but always lets one go", () => {
    const have = full();
    expect(toggleCode(have, "999999").overLimit).toBe(true);
    expect(toggleCode(have, have[0]).next).toHaveLength(
      MAX_COVERAGE_PINCODES - 1
    );
  });
});

describe("selectionKey", () => {
  it("is order-independent", () => {
    expect(selectionKey(["b", "a"])).toBe(selectionKey(["a", "b"]));
    expect(selectionKey(["b", "a"])).toBe("a,b");
  });
  it("is empty for an empty selection and does not mutate", () => {
    const sel = ["b", "a"];
    selectionKey(sel);
    expect(sel).toEqual(["b", "a"]);
    expect(selectionKey([])).toBe("");
  });
});

describe("overBy", () => {
  it("is zero at or under the cap and the excess above it", () => {
    expect(overBy(0)).toBe(0);
    expect(overBy(500)).toBe(0);
    expect(overBy(503)).toBe(3);
    expect(overBy(7, 5)).toBe(2);
  });
});

describe("matchesName", () => {
  it("matches everything for an empty query", () => {
    expect(matchesName("Telangana", "")).toBe(true);
    expect(matchesName("Telangana", "   ")).toBe(true);
  });
  it("matches a substring, ignoring case and outer spaces", () => {
    expect(matchesName("Telangana", " LANG ")).toBe(true);
    expect(matchesName("Telangana", "kerala")).toBe(false);
  });
});
