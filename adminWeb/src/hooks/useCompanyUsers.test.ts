import { describe, expect, it } from "vitest"

import { assignableRoles } from "./useCompanyUsers"
import type { RoleOption } from "@/types/user"

/** The shipped catalogue plus Task 02's appended franchise block (ranks 8–10). */
const catalogue: RoleOption[] = [
  { key: "admin", label: "Admin", rank: 1 },
  { key: "national_head", label: "National Head", rank: 2 },
  { key: "regional_head", label: "Regional Head", rank: 3 },
  { key: "area_manager", label: "Area Manager", rank: 4 },
  { key: "technician", label: "Technician", rank: 5 },
  { key: "vendor", label: "Vendor", rank: 6 },
  { key: "vendor_user", label: "Vendor User", rank: 7 },
  { key: "franchisee_admin", label: "Franchisee Admin", rank: 8 },
  { key: "facility_admin", label: "Facility Admin", rank: 9 },
  { key: "facility_operator", label: "Facility Operator", rank: 10 },
]

describe("assignableRoles", () => {
  it("offers only staff roles below the Admin, and none it cannot create", () => {
    const keys = assignableRoles(catalogue, "admin").map((r) => r.key)
    for (const expected of [
      "national_head",
      "regional_head",
      "area_manager",
    ]) {
      expect(keys).toContain(expected)
    }
    for (const refused of [
      "technician",
      "vendor",
      "vendor_user",
      "franchisee_admin",
      "facility_admin",
      "facility_operator",
    ]) {
      expect(keys).not.toContain(refused)
    }
  })

  it("narrows with rank, not with a hardcoded staff list", () => {
    expect(assignableRoles(catalogue, "area_manager").map((r) => r.key)).toEqual([])
    expect(assignableRoles(catalogue, "national_head").map((r) => r.key)).toEqual([
      "regional_head",
      "area_manager",
    ])
  })
})