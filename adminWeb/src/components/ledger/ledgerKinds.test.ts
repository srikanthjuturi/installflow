import { describe, expect, it } from "vitest";
import {
  isKnownKind,
  kindChip,
  kindLabel,
  LEDGER_KINDS,
  poolSign,
} from "./ledgerKinds";

describe("poolSign", () => {
  it("speed_reward leaves the pool, speed_penalty enters it", () => {
    expect(poolSign("speed_reward")).toBe(-1);
    expect(poolSign("speed_penalty")).toBe(1);
  });
  it("penalty +1, bonus -1, reversal -1", () => {
    expect(poolSign("penalty")).toBe(1);
    expect(poolSign("bonus")).toBe(-1);
    expect(poolSign("reversal")).toBe(-1);
  });
  it("an unknown kind reads +1, never NaN", () => {
    expect(poolSign("teleport")).toBe(1);
    expect(poolSign("teleport") * 15000).toBe(15000);
  });
  it("is an own-property lookup: 'constructor' is not a function value", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(poolSign(k)).toBe(1);
      expect(Number.isNaN(poolSign(k) * 100)).toBe(false);
    }
  });
});

describe("kindLabel", () => {
  it("prints the approved labels", () => {
    expect(kindLabel("penalty")).toBe("Penalty");
    expect(kindLabel("bonus")).toBe("Bonus");
    expect(kindLabel("reversal")).toBe("Penalty reversed");
    expect(kindLabel("speed_reward")).toBe("Speed reward");
    expect(kindLabel("speed_penalty")).toBe("Speed penalty");
  });
  it("prints an unknown kind as itself", () => {
    expect(kindLabel("teleport")).toBe("teleport");
    expect(kindLabel("constructor")).toBe("constructor");
  });
});

describe("kindChip", () => {
  it("speed kinds borrow the bonus and penalty tones", () => {
    expect(kindChip("speed_reward")).toBe(kindChip("bonus"));
    expect(kindChip("speed_penalty")).toBe(kindChip("penalty"));
  });
  it("an unknown kind gets the neutral chip", () => {
    expect(kindChip("teleport")).toBe("bg-surface-3 text-ink-2");
    expect(kindChip("constructor")).toBe("bg-surface-3 text-ink-2");
  });
});

describe("kinds the screen knows", () => {
  it("LEDGER_KINDS are all known and all labelled", () => {
    for (const k of LEDGER_KINDS) {
      expect(isKnownKind(k)).toBe(true);
      expect(kindLabel(k)).not.toBe(k);
    }
  });
  it("an unknown kind is not known", () => {
    expect(isKnownKind("teleport")).toBe(false);
    expect(isKnownKind("constructor")).toBe(false);
  });
});
