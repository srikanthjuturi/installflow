import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import {
  EMPTY_RESET_PASSWORD,
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/components/auth/changePasswordSchema";

/**
 * The last step: choose the password, and be signed in on the reply.
 *
 * There is no "current password" field and no Cancel — this is reached only by
 * proving the email with a one-time code, and there is nowhere to cancel back
 * to that would leave the account in a better state. The button says what
 * happens next, because what happens next is not "return to the sign-in form".
 */
export function NewPasswordStep({
  email,
  onSubmit,
}: {
  /** Shown so the last screen still names the account being changed. */
  email: string;
  /** Rejects if the call fails; the reason is already in the toaster. */
  onSubmit: (values: ResetPasswordValues) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onChange",
    defaultValues: EMPTY_RESET_PASSWORD,
  });

  const submit = async (values: ResetPasswordValues) => {
    try {
      await onSubmit(values);
    } catch {
      // Reported in the toaster by the global mutation handler.
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <h1 className="text-[22px] font-semibold">Choose a new password</h1>
      <p className="mt-1.5 text-[13px] text-ink-2">
        For <b className="font-semibold text-ink">{email}</b>.
      </p>

      <FieldGroup className="mt-6.5">
        <Field data-invalid={errors.newPassword ? true : undefined}>
          <FieldLabel htmlFor="reset-newPassword">New password</FieldLabel>
          <PasswordInput
            id="reset-newPassword"
            autoComplete="new-password"
            autoFocus
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={
              errors.newPassword ? "reset-newPassword-error" : "reset-newPassword-hint"
            }
            {...register("newPassword")}
          />
          {errors.newPassword ? (
            <FieldDescription
              id="reset-newPassword-error"
              role="alert"
              className="text-danger"
            >
              {errors.newPassword.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="reset-newPassword-hint">
              At least 8 characters.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.confirmPassword ? true : undefined}>
          <FieldLabel htmlFor="reset-confirmPassword">
            Repeat new password
          </FieldLabel>
          <PasswordInput
            id="reset-confirmPassword"
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={
              errors.confirmPassword ? "reset-confirmPassword-error" : undefined
            }
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <FieldDescription
              id="reset-confirmPassword-error"
              role="alert"
              className="text-danger"
            >
              {errors.confirmPassword.message}
            </FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>

      <Button
        type="submit"
        className="mt-5.5 h-11.5 w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
        {isSubmitting ? "Saving…" : "Save and sign in"}
      </Button>

      <p className="mt-4.5 text-center text-xs text-ink-3">
        You will be signed out on every other device.
      </p>
    </form>
  );
}
