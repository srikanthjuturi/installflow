import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * Create/edit schemas for company users.
 *
 * The create form's role must be one the signed-in user may assign (strictly
 * below their own rank) — the allowed keys are passed in, and the backend
 * enforces the same rule. Role and email are not editable after creation, so
 * the edit schema omits them.
 */

export function createUserSchema(assignableKeys: string[]) {
  return z.object({
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
  });
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
};

export const editUserSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(255),
  phone: z.string().trim().max(32),
  isActive: z.boolean(),
});

export type EditUserValues = z.infer<typeof editUserSchema>;
export const editUserResolver = zodResolver(editUserSchema);
