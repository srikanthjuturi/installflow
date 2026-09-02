import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { LinkButton } from "@/components/shared/LinkButton";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const schema = z.object({ email: z.email("Enter a valid work email") });

export type ForgotEmailValues = z.infer<typeof schema>;

/**
 * Step one of a forgotten password: which account.
 *
 * Deliberately asks for the work email rather than offering a choice of email
 * or phone. A technician has no password to reset — their phone IS the
 * credential — so there is exactly one kind of account this flow can act on.
 */
export function ForgotEmailStep({
  defaultEmail,
  onSubmit,
}: {
  defaultEmail: string;
  /** Rejects if the call fails; the reason is already in the toaster. */
  onSubmit: (values: ForgotEmailValues) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotEmailValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { email: defaultEmail },
  });

  const submit = async (values: ForgotEmailValues) => {
    try {
      await onSubmit(values);
    } catch {
      // Reported in the toaster by the global mutation handler.
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      {/* A link, not a Button with an onClick — it navigates, so it should
          behave like an address: middle-clickable, copyable, in the links
          rotor. That is what `LinkButton` exists for. */}
      <LinkButton to="/login" variant="ghost" size="sm" className="-ml-2">
        <ArrowLeft data-icon="inline-start" />
        Back to sign in
      </LinkButton>

      <h1 className="mt-4.5 text-[22px] font-semibold">Reset your password</h1>
      <p className="mt-1.5 text-[13px] text-ink-2">
        Enter your work email and we'll send you a 6-digit code.
      </p>

      <FieldGroup className="mt-6.5">
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="reset-email" required>
            Work email
          </FieldLabel>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@reliancegreentech.in"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "reset-email-error" : undefined}
            {...register("email")}
          />
          {errors.email ? (
            <FieldDescription id="reset-email-error" role="alert">
              {errors.email.message}
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
        {isSubmitting ? "Sending…" : "Send code"}
      </Button>

      <p className="mt-4.5 text-center text-xs text-ink-3">
        Technicians sign in with a one-time code in the app, not a password.
      </p>
    </form>
  );
}
