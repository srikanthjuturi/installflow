import { describe, expect, it } from "vitest"

import { plural } from "./plural"

describe("plural", () => {
  it("uses the singular noun for exactly one", () => {
    expect(plural(1, "district")).toBe("1 district")
  })

  it("adds an s for zero", () => {
    expect(plural(0, "district")).toBe("0 districts")
  })

  it("adds an s for many", () => {
    expect(plural(75, "district")).toBe("75 districts")
  })

  it("adds thousands separators", () => {
    expect(plural(19496, "pincode")).toBe("19,496 pincodes")
  })
})
