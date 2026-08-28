import { z } from "zod";

/**
 * The password bcrypt can actually hash, in BYTES.
 *
 * Not 128 characters, which is what this said until it was found to be a lie:
 * bcrypt refuses anything over 72 bytes, so a longer password passed validation
 * here and then failed on the server. And it is bytes, not characters — an
 * emoji is four of them, Devanagari three — so a character count would still be
 * wrong for anyone not typing ASCII.
 */
const MAX_PASSWORD_BYTES = 72;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

/**
 * The one definition of "a password this console will accept".
 *
 * Mirrors the backend's rules so the first refusal happens here rather than
 * after a round trip. Both the signed-in change and the signed-out reset build
 * on it, so the two cannot drift into disagreeing about what is acceptable —
 * which is what a second `min(8)` written out longhand would eventually do.
 */
export const newPasswordField = z
  .string()
  .min(8, "At least 8 characters")
  .refine(
    (v) => byteLength(v) <= MAX_PASSWORD_BYTES,
    "Too long. Accented and non-Latin characters count as more than one each."
  );

/** The two fields every password form has: the new one, and it again. */
const confirmable = {
  newPassword: newPasswordField,
  confirmPassword: z.string().min(1, "Repeat the new password"),
};

/**
 * On `confirmPassword`, not `newPassword`: the field in error should be the one
 * the person needs to fix. Shared for the same reason the field above is.
 */
function checkTheyMatch(
  v: { newPassword: string; confirmPassword: string },
  ctx: z.RefinementCtx
) {
  if (v.confirmPassword && v.confirmPassword !== v.newPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "The two passwords do not match",
    });
  }
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    ...confirmable,
  })
  .superRefine((v, ctx) => {
    if (v.newPassword && v.newPassword === v.currentPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "Choose a password you have not used here before",
      });
    }
    checkTheyMatch(v, ctx);
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const EMPTY_CHANGE_PASSWORD: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/**
 * Setting a password after proving the email by one-time code.
 *
 * No current password to compare against — that is the whole point of the flow
 * — so "not the one you already have" is the server's check alone, and it
 * arrives in the toaster like every other API refusal.
 */
export const resetPasswordSchema = z
  .object(confirmable)
  .superRefine(checkTheyMatch);

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const EMPTY_RESET_PASSWORD: ResetPasswordValues = {
  newPassword: "",
  confirmPassword: "",
};
