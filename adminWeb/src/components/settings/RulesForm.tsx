import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ThresholdSlider } from "./ThresholdSlider";
import { SlaRuleList } from "./SlaRuleList";
import {
  BANDWIDTH_OPTIONS,
  rulesSchema,
  toFormValues,
  type RulesFormValues,
} from "./rulesSchema";
import { money } from "@/utils/money";
import type { RulesConfig } from "@/services/settings";

interface RulesFormProps {
  rules: RulesConfig;
  onSubmit: (values: RulesFormValues) => void;
  isSaving: boolean;
}

export function RulesForm({ rules, onSubmit, isSaving }: RulesFormProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<RulesFormValues>({
    resolver: zodResolver(rulesSchema),
    defaultValues: toFormValues(rules),
  });

  const { fields } = useFieldArray({ control, name: "penalty" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <RuleCard title="SLA windows">
          {/* Definitional, not configurable: a 24h SLA type IS a 24-hour
              window. Changing it would redefine the ticket, not a setting. */}
          <SlaRuleList rules={rules.sla} />
          <p className="text-ink-3 mt-3 text-xs">
            SLA windows are fixed by the ticket's service level and are not
            configurable here.
          </p>
        </RuleCard>

        <RuleCard title="Cancellation penalty bands">
          <FieldSet>
            <FieldLegend className="sr-only">Penalty amount per band</FieldLegend>
            <FieldGroup className="gap-3">
              {fields.map((f, i) => {
                const err = errors.penalty?.[i]?.amount?.message;
                const id = `penalty-${i}`;
                return (
                  <Field key={f.id} data-invalid={err ? true : undefined}>
                    <FieldLabel htmlFor={id}>{f.band}</FieldLabel>
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${id}-error` : undefined}
                      {...register(`penalty.${i}.amount`, { valueAsNumber: true })}
                    />
                    {err ? (
                      <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
                        {err}
                      </FieldDescription>
                    ) : null}
                  </Field>
                );
              })}

              <Field data-invalid={errors.penaltyCap ? true : undefined}>
                <FieldLabel htmlFor="penalty-cap">Monthly cap per technician</FieldLabel>
                <Input
                  id="penalty-cap"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-invalid={errors.penaltyCap ? true : undefined}
                  aria-describedby={
                    errors.penaltyCap ? "penalty-cap-error" : "penalty-cap-hint"
                  }
                  {...register("penaltyCap", { valueAsNumber: true })}
                />
                {errors.penaltyCap ? (
                  <FieldDescription id="penalty-cap-error" role="alert" className="text-danger">
                    {errors.penaltyCap.message}
                  </FieldDescription>
                ) : (
                  <FieldDescription id="penalty-cap-hint">
                    Currently {money(rules.penaltyCap)}. Penalties fund the escalation
                    bonus pool.
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </FieldSet>

          <p className="bg-warn-bg text-warn mt-3.5 flex items-start gap-2 rounded-md px-3 py-2.5 text-xs">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              These bands differ from the technician app's. Saving here does not
              change what a technician is charged.
            </span>
          </p>
        </RuleCard>

        <RuleCard title="AI verification threshold">
          <Controller
            name="aiThreshold"
            control={control}
            render={({ field }) => (
              <ThresholdSlider
                value={field.value}
                min={rules.ai.min}
                max={rules.ai.max}
                onChange={field.onChange}
                disabled={isSaving}
              />
            )}
          />
        </RuleCard>

        <RuleCard title="Timing & bandwidth">
          <FieldGroup className="gap-3">
            <HoursField
              id="slot-timeout"
              label="Slot-confirm timeout"
              hint="Customer silence before the slot request auto-escalates."
              error={errors.slotConfirmTimeoutHours?.message}
              register={register("slotConfirmTimeoutHours", { valueAsNumber: true })}
            />
            <HoursField
              id="escalation-trigger"
              label="Escalation trigger"
              hint="Hours before the slot at which an unassigned ticket escalates."
              error={errors.escalationTriggerHours?.message}
              register={register("escalationTriggerHours", { valueAsNumber: true })}
            />
            <HoursField
              id="customer-wait"
              label="Wait before manager closure"
              hint="Customer silence before force-closure becomes available."
              error={errors.customerWaitHours?.message}
              register={register("customerWaitHours", { valueAsNumber: true })}
            />

            <FieldSet>
              <FieldLegend className="text-[13px] font-medium">Bandwidth model</FieldLegend>
              <Controller
                name="bandwidthModel"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-2" role="radiogroup" aria-label="Bandwidth model">
                    {BANDWIDTH_OPTIONS.map((o) => (
                      <label
                        key={o.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
                          field.value === o.value
                            ? "border-brand-500 bg-brand-100/40"
                            : "border-line hover:border-brand-400",
                        )}
                      >
                        <input
                          type="radio"
                          className="accent-brand-500 mt-0.5"
                          checked={field.value === o.value}
                          onChange={() => field.onChange(o.value)}
                        />
                        <span>
                          <span className="block text-[13px] font-semibold">{o.label}</span>
                          <span className="text-ink-3 block text-xs">{o.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              />
            </FieldSet>
          </FieldGroup>
        </RuleCard>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5">
        {isDirty ? (
          <span className="text-ink-3 mr-auto text-xs">Unsaved changes</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(toFormValues(rules))}
          disabled={!isDirty || isSaving}
        >
          Reset defaults
        </Button>
        <Button type="submit" disabled={!isDirty || isSaving}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          Save configuration
        </Button>
      </div>
    </form>
  );
}

function HoursField({
  id,
  label,
  hint,
  error,
  register,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string;
  register: ReturnType<ReturnType<typeof useForm<RulesFormValues>>["register"]>;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          className="w-28"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          {...register}
        />
        <span className="text-ink-2 text-[13px]">hours</span>
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

function RuleCard({ title, children }: { title: string; children: React.ReactNode }) {
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
