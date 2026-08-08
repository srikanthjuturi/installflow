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
 * regions, an area manager exactly one region plus its pincodes, and everyone
 * else carries none (a national head is all-India).
 */

export const REGIONAL_HEAD = "regional_head";
export const AREA_MANAGER = "area_manager";

export const PINCODE_RE = /^[0-9]{6}$/;

/** Shared by both forms so the two can't drift apart. */
function checkScope(
  role: string,
  regionIds: string[],
  pincodes: string[],
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
    if (regionIds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["regionIds"],
        message: "Select one region",
      });
    }
    if (pincodes.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["pincodes"],
        message: "Add at least one pincode",
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
      pincodes: z.array(z.string()),
    })
    .superRefine((v, ctx) => checkScope(v.role, v.regionIds, v.pincodes, ctx));
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
  pincodes: [],
};

/** Role is fixed on edit, so it is closed over rather than validated. */
export function editUserSchema(role: string) {
  return z
    .object({
      fullName: z.string().trim().min(2, "Full name is required").max(255),
      phone: z.string().trim().max(32),
      isActive: z.boolean(),
      regionIds: z.array(z.string()),
      pincodes: z.array(z.string()),
    })
    .superRefine((v, ctx) => checkScope(role, v.regionIds, v.pincodes, ctx));
}

export type EditUserValues = z.infer<ReturnType<typeof editUserSchema>>;

export const editUserResolver = (role: string) =>
  zodResolver(editUserSchema(role));
