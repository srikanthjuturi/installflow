import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { PlatformSettings } from "@/types/platform";
import {
  platformRulesSchema,
  toFormValues,
  type PlatformRulesValues,
} from "./platformRulesSchema";

/**
 * The platform's rules. Two cards, because they answer two different questions:
 * what credits cost and are worth, and where recharge payments land.
 *
 * Each credit rule says WHO it reaches, under its box — the one thing a
 * superadmin cannot see from the number itself: free credits touch only
 * companies created from now on; the other two touch every company at once.
 */
export function PlatformRulesForm({
  settings,
  isSaving,
  onSubmit,
}: {
  settings: PlatformSettings;
  isSaving: boolean;
  onSubmit: (values: PlatformRulesValues) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<PlatformRulesValues>({
    resolver: zodResolver(platformRulesSchema),
    defaultValues: toFormValues(settings),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <RulesCard title="Credits">
          <FieldGroup className="gap-3">
            <CountField
              id="free-credits"
              label="Free credits for a new company"
              unit="credits"
              hint="Given once, when a company is created. Changing it gives existing companies nothing."
              error={errors.freeCredits?.message}
              register={register("freeCredits", { valueAsNumber: true })}
            />
            <CountField
              id="ticket-credits"
              label="Credits per ticket"
              unit="credits"
              hint="Charged when a ticket is raised. Applies to every company from its next ticket."
              error={errors.ticketCredits?.message}
              register={register("ticketCredits", { valueAsNumber: true })}
            />
            <CountField
              id="minus-limit"
              label="Minus credit limit"
              unit="credits"
              hint="How far below zero a company may go before new tickets are paused. Applies to every company at once."
              error={errors.minusCreditLimit?.message}
              register={register("minusCreditLimit", { valueAsNumber: true })}
            />
            <CountField
              id="min-recharge"
              label="Minimum recharge"
              unit="₹"
              hint="The smallest amount a company may recharge. One credit per rupee."
              error={errors.minRechargeRupees?.message}
              register={register("minRechargeRupees", { valueAsNumber: true })}
            />
          </FieldGroup>
        </RulesCard>

        <RulesCard title="Recharge payments">
          <FieldGroup className="gap-3">
            <Field data-invalid={errors.upiId ? true : undefined}>
              <FieldLabel htmlFor="platform-upi-id">UPI ID</FieldLabel>
              <Input
                id="platform-upi-id"
                autoComplete="off"
                placeholder="e.g. payments@okaxis"
                className="font-mono"
                aria-invalid={errors.upiId ? true : undefined}
                aria-describedby={errors.upiId ? "platform-upi-id-error" : "platform-upi-id-hint"}
                {...register("upiId")}
              />
              {errors.upiId ? (
                <FieldDescription id="platform-upi-id-error" role="alert" className="text-danger">
                  {errors.upiId.message}
                </FieldDescription>
              ) : (
                <FieldDescription id="platform-upi-id-hint">
                  Every company&apos;s recharge QR pays this UPI ID. Leave empty and no
                  company can recharge.
                </FieldDescription>
              )}
            </Field>
            <Field data-invalid={errors.upiName ? true : undefined}>
              <FieldLabel htmlFor="platform-upi-name">Name on the UPI account</FieldLabel>
              <Input
                id="platform-upi-name"
                autoComplete="off"
                aria-invalid={errors.upiName ? true : undefined}
                aria-describedby={errors.upiName ? "platform-upi-name-error" : "platform-upi-name-hint"}
                {...register("upiName")}
              />
              {errors.upiName ? (
                <FieldDescription id="platform-upi-name-error" role="alert" className="text-danger">
                  {errors.upiName.message}
                </FieldDescription>
              ) : (
                <FieldDescription id="platform-upi-name-hint">
                  What a payer&apos;s UPI app shows when they scan — they are told to check it.
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </RulesCard>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5">
        {isDirty ? <span className="mr-auto text-xs text-ink-3">Unsaved changes</span> : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(toFormValues(settings))}
          disabled={!isDirty || isSaving}
        >
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || isSaving}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          Save rules
        </Button>
      </div>
    </form>
  );
}

function CountField({
  id,
  label,
  unit,
  hint,
  error,
  register,
}: {
  id: string;
  label: string;
  unit: string;
  hint: string;
  error?: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          className="w-32"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          {...register}
        />
        <span className="text-[13px] text-ink-2">{unit}</span>
      </div>
      {error ? (
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : (
        <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
      )}
    </Field>
  );
}

function RulesCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-3.5 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle>
          <h2 className="text-sm font-semibold">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
