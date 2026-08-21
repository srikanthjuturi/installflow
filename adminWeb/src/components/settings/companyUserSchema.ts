import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * Create/edit schemas for company users.
 *
 * The create form's role must be one the signed-in user may assign (strictly
 * below their own rank) — the allowed keys are passed in, and the backend
 * enforces the same rule. Role and email are not editable after creation, so
 * the edit schema omits them.
 *
 * Territory rules mirror the server exactly: a regional head covers one or more
 * REGIONS and every state inside them comes with it; an area manager covers one
 * or more STATES, and his region is derived from them rather than chosen; and
 * everyone else carries none (a national head is all-India).
 */

export const REGIONAL_HEAD = "regional_head";
export const AREA_MANAGER = "area_manager";

/** Still used by the technician form, which DOES take individual pincodes. */
export const PINCODE_RE = /^[0-9]{6}$/;

/**
 * Does this role carry a territory at all?
 *
 * Mirrors what `ScopeField` renders — a national head shows "All India", the
 * two territory roles show a picker, and everyone else shows nothing. The forms
 * use it to decide whether the Territory section belongs on the page at all: a
 * section heading over an empty box reads as a field that failed to load.
 */
export function roleHasTerritory(role: string): boolean {
  return (
    role === "national_head" || role === REGIONAL_HEAD || role === AREA_MANAGER
  );
}

/** Shared by both forms so the two can't drift apart. */
function checkScope(
  role: string,
  regionIds: string[],
  stateIds: string[],
  ctx: z.RefinementCtx
) {
  if (role === REGIONAL_HEAD) {
    if (regionIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["regionIds"],
        message: "Select at least one region",
      });
    }
    return;
  }
  if (role === AREA_MANAGER) {
    // No region check: an area manager sends states only, and the server
    // derives his region from them.
    if (stateIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["stateIds"],
        message: "Select at least one state",
      });
    }
  }
}

export function createUserSchema(assignableKeys: string[]) {
  return z
    .object({
      fullName: z.string().trim().min(2, "Full name is required").max(255),
      email: z
        .string()
        .trim()
        .min(1, "Email is required")
        .pipe(z.email("Enter a valid email")),
      phone: z.string().trim().max(32),
      role: z
        .string()
        .refine((v) => assignableKeys.includes(v), "Select a role"),
      password: z.string().min(8, "At least 8 characters").max(128),
      regionIds: z.array(z.string()),
      stateIds: z.array(z.string()),
    })
    .superRefine((v, ctx) => checkScope(v.role, v.regionIds, v.stateIds, ctx));
}

export type CreateUserValues = z.infer<ReturnType<typeof createUserSchema>>;

export const createUserResolver = (assignableKeys: string[]) =>
  zodResolver(createUserSchema(assignableKeys));

export const EMPTY_INVITE: CreateUserValues = {
  fullName: "",
  email: "",
  phone: "",
  role: "",
  password: "",
  regionIds: [],
  stateIds: [],
};

/** Role is fixed on edit, so it is closed over rather than validated. */
export function editUserSchema(role: string) {
  return z
    .object({
      fullName: z.string().trim().min(2, "Full name is required").max(255),
      phone: z.string().trim().max(32),
      isActive: z.boolean(),
      regionIds: z.array(z.string()),
      stateIds: z.array(z.string()),
    })
    .superRefine((v, ctx) => checkScope(role, v.regionIds, v.stateIds, ctx));
}

export type EditUserValues = z.infer<ReturnType<typeof editUserSchema>>;

export const editUserResolver = (role: string) =>
  zodResolver(editUserSchema(role));
