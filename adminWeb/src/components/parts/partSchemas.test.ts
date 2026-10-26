import { describe, expect, it } from "vitest";
import {
  PART_NAME_MAX,
  noteOrNull,
  noteSchema,
  rejectSchema,
  validatePartName,
} from "./partSchemas";

describe("rejectSchema", () => {
  it("requires a reason of 3 to 255 characters", () => {
    expect(rejectSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "no" }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "   x  " }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "Out of stock" }).success).toBe(true);
    expect(rejectSchema.safeParse({ reason: "x".repeat(255) }).success).toBe(true);
    expect(rejectSchema.safeParse({ reason: "x".repeat(256) }).success).toBe(false);
  });

  it("trims the reason it sends", () => {
    const parsed = rejectSchema.parse({ reason: "  Out of stock  " });
    expect(parsed.reason).toBe("Out of stock");
  });
});

describe("noteSchema / noteOrNull", () => {
  it("allows an empty note and caps it at 500", () => {
    expect(noteSchema.safeParse({ note: "" }).success).toBe(true);
    expect(noteSchema.safeParse({ note: "x".repeat(500) }).success).toBe(true);
    expect(noteSchema.safeParse({ note: "x".repeat(501) }).success).toBe(false);
  });

  it("sends an empty note as null", () => {
    expect(noteOrNull("")).toBeNull();
    expect(noteOrNull("   ")).toBeNull();
    expect(noteOrNull(" given at the counter ")).toBe("given at the counter");
  });
});

describe("validatePartName", () => {
  const own = [
    { id: "a", name: "Door gasket" },
    { id: "b", name: "Wall  bracket" },
  ];

  it("accepts a new name", () => {
    expect(validatePartName("Remote", own)).toBeNull();
  });

  it("asks for a name when blank", () => {
    expect(validatePartName("   ", own)).toBe("Enter a part name");
  });

  it("caps the length at 80", () => {
    expect(validatePartName("x".repeat(PART_NAME_MAX), own)).toBeNull();
    expect(validatePartName("x".repeat(PART_NAME_MAX + 1), own)).toBe(
      "Up to 80 characters"
    );
  });

  it("refuses a duplicate in any case and any spacing", () => {
    expect(validatePartName("door GASKET", own)).toBe(
      "That part is already on this list"
    );
    expect(validatePartName("wall bracket", own)).toBe(
      "That part is already on this list"
    );
  });

  it("counts a hidden row — it still owns its name", () => {
    expect(
      validatePartName("Remote", [{ id: "c", name: "Remote" }])
    ).toBe("That part is already on this list");
  });

  it("does not make a row duplicate itself on rename", () => {
    expect(validatePartName("Door Gasket", own, "a")).toBeNull();
    expect(validatePartName("wall bracket", own, "a")).toBe(
      "That part is already on this list"
    );
  });
});
