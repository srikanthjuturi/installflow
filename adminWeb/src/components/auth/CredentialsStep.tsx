import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

const schema = z.object({
  email: z.email("Enter a valid work email"),
  password: z.string().min(1, "Password is required"),
  trustDevice: z.boolean(),
});

export type Credentials = z.infer<typeof schema>;

export function CredentialsStep({
  defaultEmail,
  onSubmit,
  googleSlot,
}: {
  defaultEmail: string;
  /** Rejects if the call fails; the message is shown, never the password. */
  onSubmit: (values: Credentials) => Promise<void>;
  /**
   * The Google button, passed in rather than imported.
   *
   * Keeps this a pure react-hook-form component and leaves the requirement to
   * be inside `GoogleOAuthProvider` with `LoginPage`, which owns that provider.
   * Omitted when `VITE_GOOGLE_CLIENT_ID` is unset.
   */
  googleSlot?: React.ReactNode;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({
    resolver: zodResolver(schema),
    // Validate as the user types so errors surface on change, not only submit.
    mode: "onChange",
    defaultValues: { email: defaultEmail, password: "", trustDevice: true },
  });

  /**
   * Awaited so `isSubmitting` covers the request, not just validation. The
   * rejection is swallowed on purpose: the global handler in `App.tsx` has
   * already put the reason in the toaster, and rethrowing here would only
   * surface an unhandled rejection.
   */
  const submit = async (values: Credentials) => {
    try {
      await onSubmit(values);
    } catch {
      // Reported in the toaster.
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit(submit)} noValidate>
      <h1 className="text-[22px] font-semibold">Sign in</h1>
      <p className="mt-1.5 text-[13px] text-ink-2">
        Use your ops credentials to continue.
      </p>

      <FieldGroup className="mt-6.5">
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@reliancegreentech.in"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email ? (
            <FieldDescription id="email-error" role="alert">
              {errors.email.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password ? (
            <FieldDescription id="password-error" role="alert">
              {errors.password.message}
            </FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox id="trust" defaultChecked {...register("trustDevice")} />
          Trust this device
        </label>
        <Link
          to="/forgot-password"
          className="font-medium text-brand-400 hover:text-brand-500"
        >
          Forgot password?
        </Link>
      </div>

      {/* Whatever the envelope reported goes to the toaster, like every other
          failed request in the console. */}
      <Button
        type="submit"
        className="mt-5.5 h-11.5 w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>

      {/* Below the password fields, and outside the <form>. Below because every
          existing user has a password and it is the primary credential here;
          outside because Google's button is a foreign iframe that has no
          business being swept into a submit. */}
      {googleSlot ? (
        <div className="mt-5.5">
          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-4.5">{googleSlot}</div>
        </div>
      ) : null}

      <p className="mt-4.5 text-center text-xs text-ink-3">
        Access is restricted to authorised console accounts.
      </p>
    </>
  );
}
