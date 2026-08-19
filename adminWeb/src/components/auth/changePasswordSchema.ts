import { z } from "zod";

/**
 * Mirrors the backend's rules so the first refusal happens here rather than
 * after a round trip. `min(8)` matches every other password field in the
 * console; the two must not drift into disagreeing about what is acceptable.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "At least 8 characters")
      .max(128, "At most 128 characters"),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword && v.newPassword === v.currentPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "Choose a password you have not used here before",
      });
    }
    // On `confirmPassword`, not `newPassword`: the field in error should be the
    // one the person needs to fix.
    if (v.confirmPassword && v.confirmPassword !== v.newPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "The two passwords do not match",
      });
    }
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const EMPTY_CHANGE_PASSWORD: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};
