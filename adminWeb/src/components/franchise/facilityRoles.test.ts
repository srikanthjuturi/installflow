import { describe, expect, it } from "vitest";
import {
  canManageFacilityUser,
  facilityUserSchema,
  rolesViewerCanAdd,
} from "./facilityRoles";

describe("rolesViewerCanAdd", () => {
  it("lets a franchisee admin add both roles", () => {
    expect(rolesViewerCanAdd("franchisee_admin")).toEqual([
      "facility_admin",
      "facility_operator",
    ]);
  });

  it("lets a facility admin add only operators — a single option that fills itself", () => {
    expect(rolesViewerCanAdd("facility_admin")).toEqual(["facility_operator"]);
  });

  it("lets Admin and National Head add both (the HOME card, R4)", () => {
    expect(rolesViewerCanAdd("admin")).toHaveLength(2);
    expect(rolesViewerCanAdd("national_head")).toHaveLength(2);
  });

  it("offers nothing to anybody else", () => {
    expect(rolesViewerCanAdd("facility_operator")).toEqual([]);
    expect(rolesViewerCanAdd("regional_head")).toEqual([]);
    expect(rolesViewerCanAdd("area_manager")).toEqual([]);
    expect(rolesViewerCanAdd(undefined)).toEqual([]);
  });
});

describe("canManageFacilityUser", () => {
  it("shows a facility admin the menu only on operators", () => {
    expect(canManageFacilityUser("facility_admin", "facility_operator", false)).toBe(true);
    expect(canManageFacilityUser("facility_admin", "facility_admin", false)).toBe(false);
  });

  it("shows a franchisee admin the menu on both", () => {
    expect(canManageFacilityUser("franchisee_admin", "facility_admin", false)).toBe(true);
    expect(canManageFacilityUser("franchisee_admin", "facility_operator", false)).toBe(true);
  });

  it("never on your own row", () => {
    expect(canManageFacilityUser("franchisee_admin", "facility_admin", true)).toBe(false);
  });

  it("never for a facility operator", () => {
    expect(canManageFacilityUser("facility_operator", "facility_operator", false)).toBe(false);
  });
});

describe("facilityUserSchema", () => {
  const valid = {
    fullName: "Arjun Rao",
    email: "arjun@example.com",
    phone: "98220 11223",
    role: "Facility Operator" as const,
  };

  it("sends the phone as E.164", () => {
    const parsed = facilityUserSchema.parse({ ...valid, phone: "9822011223" });
    expect(parsed.phone).toBe("+919822011223");
  });

  it("requires a phone, an email and a role", () => {
    expect(facilityUserSchema.safeParse({ ...valid, phone: "" }).success).toBe(false);
    expect(facilityUserSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    expect(facilityUserSchema.safeParse({ ...valid, role: undefined }).success).toBe(false);
    expect(facilityUserSchema.safeParse({ ...valid, role: "Franchisee Admin" }).success).toBe(
      false
    );
  });
});
