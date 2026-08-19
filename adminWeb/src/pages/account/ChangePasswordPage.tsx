import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import {
  EMPTY_CHANGE_PASSWORD,
  changePasswordSchema,
  type ChangePasswordValues,
} from "@/components/auth/changePasswordSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useChangePassword } from "@/hooks/useAuth";
import { useSession } from "@/store/session";

/**
 * One screen, mounted twice — `/account/password` for staff and
 * `/portal/password` for a vendor. Nothing about changing your own password
 * differs between the two, so a second copy would only be a second thing to
 * keep in step.
 *
 * No feature key: anyone with a password may change it.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const portal = useSession((s) => s.portal);
  const change = useChangePassword();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
    defaultValues: EMPTY_CHANGE_PASSWORD,
  });

  const submit = async (values: ChangePasswordValues) => {
    try {
      await change.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.add({
        title: "Password changed",
        description: "You have been signed out on every other device.",
      });
      navigate(portal ? "/portal/account" : "/account", { replace: true });
    } catch {
      // Already in the toaster, via the global mutation handler.
    }
  };

  return (
    <>
      <PageMeta
        title="Change password"
        description="Set a new password for your account"
      />

      <h2 className="text-lg font-semibold">Change password</h2>

      <Card className="mt-4 max-w-md">
        <CardHeader className="border-b border-line-2 pb-4">
          <CardTitle className="text-sm">Your password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(submit)} noValidate>
            <FieldGroup>
              <Field data-invalid={errors.currentPassword ? true : undefined}>
                <FieldLabel htmlFor="currentPassword">
                  Current password
                </FieldLabel>
                <PasswordInput
                  id="currentPassword"
                  autoComplete="current-password"
                  aria-invalid={errors.currentPassword ? true : undefined}
                  aria-describedby={
                    errors.currentPassword ? "currentPassword-error" : undefined
                  }
                  {...register("currentPassword")}
                />
                {errors.currentPassword ? (
                  <FieldDescription
                    id="currentPassword-error"
                    role="alert"
                    className="text-danger"
                  >
                    {errors.currentPassword.message}
                  </FieldDescription>
                ) : null}
              </Field>

              <Field data-invalid={errors.newPassword ? true : undefined}>
                <FieldLabel htmlFor="newPassword">New password</FieldLabel>
                <PasswordInput
                  id="newPassword"
                  autoComplete="new-password"
                  aria-invalid={errors.newPassword ? true : undefined}
                  aria-describedby={
                    errors.newPassword ? "newPassword-error" : "newPassword-hint"
                  }
                  {...register("newPassword")}
                />
                {errors.newPassword ? (
                  <FieldDescription
                    id="newPassword-error"
                    role="alert"
                    className="text-danger"
                  >
                    {errors.newPassword.message}
                  </FieldDescription>
                ) : (
                  <FieldDescription id="newPassword-hint">
                    At least 8 characters.
                  </FieldDescription>
                )}
              </Field>

              <Field data-invalid={errors.confirmPassword ? true : undefined}>
                <FieldLabel htmlFor="confirmPassword">
                  Repeat new password
                </FieldLabel>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  aria-invalid={errors.confirmPassword ? true : undefined}
                  aria-describedby={
                    errors.confirmPassword ? "confirmPassword-error" : undefined
                  }
                  {...register("confirmPassword")}
                />
                {errors.confirmPassword ? (
                  <FieldDescription
                    id="confirmPassword-error"
                    role="alert"
                    className="text-danger"
                  >
                    {errors.confirmPassword.message}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>

            <div className="mt-6 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate(portal ? "/portal/account" : "/account")
                }
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
