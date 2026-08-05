import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.email("Enter a valid work email"),
  password: z.string().min(1, "Password is required"),
  trustDevice: z.boolean(),
});

export type Credentials = z.infer<typeof schema>;

export function CredentialsStep({
  defaultEmail,
  onSubmit,
}: {
  defaultEmail: string;
  onSubmit: (values: Credentials) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({
    resolver: zodResolver(schema),
    defaultValues: { email: defaultEmail, password: "", trustDevice: true },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <h1 className="text-[22px] font-semibold">Sign in</h1>
      <p className="text-ink-2 mt-1.5 text-[13px]">Use your ops credentials to continue.</p>

      <FieldGroup className="mt-6.5">
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@installflow.in"
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
          <Input
            id="password"
            type="password"
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

      <div className="text-ink-2 mt-3 flex items-center justify-between text-xs">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox id="trust" defaultChecked {...register("trustDevice")} />
          Trust this device
        </label>
        <a href="#reset" className="text-brand-400 hover:text-brand-500 font-medium">
          Forgot password?
        </a>
      </div>

      <Button type="submit" className="mt-5.5 h-11.5 w-full" disabled={isSubmitting}>
        Continue
      </Button>

      <p className="text-ink-3 mt-4.5 text-center text-xs">
        We'll send a one-time code to your registered number.
      </p>
    </form>
  );
}
