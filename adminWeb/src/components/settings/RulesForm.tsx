import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { FieldGrid } from "@/components/shared/FieldGrid";
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
import { useFeatureAccess } from "@/hooks/useAuth";
// Hidden with the AI card below; put `Controller` back in the react-hook-form
// import above when it returns.
// import { ThresholdSlider } from "./ThresholdSlider";
import { rulesSchema, toFormValues, type RulesFormValues } from "./rulesSchema";
import type { RulesConfig } from "@/services/settings";

interface RulesFormProps {
  rules: RulesConfig;
  onSubmit: (values: RulesFormValues) => void;
  isSaving: boolean;
}

export function RulesForm({ rules, onSubmit, isSaving }: RulesFormProps) {
  // Two keys, because the API now makes the split: `settings.view` opens this
  // screen, `settings.edit` changes what the sweeps actually do. They were one
  // grant while Save wrote to a JavaScript object; they stopped being one the
  // moment it wrote to a table.
  const { has } = useFeatureAccess();
  const canEdit = has("settings.edit");

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
  const { fields: bonusFields } = useFieldArray({
    control,
    name: "bonusAmounts",
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <RuleCard title="Cancellation penalty bands">
          <FieldSet>
            <FieldLegend className="sr-only">
              Penalty amount per band
            </FieldLegend>
            <FieldGroup className="gap-3">
              {fields.map((f, i) => {
                const err = errors.penalty?.[i]?.amount?.message;
                const id = `penalty-${i}`;
                return (
                  <Field key={f.id} data-invalid={err ? true : undefined}>
                    {/* Every box on this screen is required — it is a settings
                        form of existing values, and clearing one is what the
                        "Enter an amount" message is for. */}
                    <FieldLabel htmlFor={id} required>
                      {f.band}
                    </FieldLabel>
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${id}-error` : undefined}
                      {...register(`penalty.${i}.amount`, {
                        valueAsNumber: true,
                      })}
                    />
                    {err ? (
                      <FieldDescription
                        id={`${id}-error`}
                        role="alert"
                        className="text-danger"
                      >
                        {err}
                      </FieldDescription>
                    ) : null}
                  </Field>
                );
              })}

              <Field data-invalid={errors.penaltyCap ? true : undefined}>
                <FieldLabel htmlFor="penalty-cap" required>
                  Monthly cap per technician
                </FieldLabel>
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
                  <FieldDescription
                    id="penalty-cap-error"
                    role="alert"
                    className="text-danger"
                  >
                    {errors.penaltyCap.message}
                  </FieldDescription>
                ) : (
                  // Both facts are here because neither is guessable from a
                  // number in a box: 0 reads as "charge nothing ever" quite as
                  // easily as "no ceiling", and "monthly" does not say which
                  // month. It replaced "Currently ₹5,000", which only ever
                  // restated the input beside it.
                  <FieldDescription id="penalty-cap-hint">
                    The most one technician can be charged in a calendar month.
                    Enter <b className="text-ink">0</b> for no cap. Penalties
                    fund the escalation bonus pool.
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </FieldSet>

          <p className="mt-3.5 flex items-start gap-2 rounded-md bg-warn-bg px-3 py-2.5 text-xs text-warn">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              These bands differ from the technician app's. Saving here does not
              change what a technician is charged.
            </span>
          </p>
        </RuleCard>

        {/* "Timing & bandwidth" until the bandwidth half was removed: it
            offered a plain count against a weighted model, and nothing in the
            product has ever read the answer — the API stores a plain
            `daily_job_cap` and weighting is modelled nowhere. Every field here
            is now a clock the sweeps actually run on. */}
        <RuleCard title="Timing">
          <FieldGroup className="gap-3">
            <SpanField
              id="slot-timeout"
              label="Slot-confirm timeout"
              unit="hours"
              hint="Customer silence before the slot request auto-escalates."
              error={errors.slotConfirmTimeoutHours?.message}
              register={register("slotConfirmTimeoutHours", {
                valueAsNumber: true,
              })}
            />
            <SpanField
              id="escalation-trigger"
              label="Escalation trigger"
              unit="hours"
              hint="Hours before the slot at which an unassigned ticket escalates."
              error={errors.escalationTriggerHours?.message}
              register={register("escalationTriggerHours", {
                valueAsNumber: true,
              })}
            />
            <SpanField
              id="customer-wait"
              label="Wait before manager closure"
              unit="hours"
              hint="Customer silence before force-closure becomes available."
              error={errors.customerWaitHours?.message}
              register={register("customerWaitHours", { valueAsNumber: true })}
            />
            <SpanField
              id="renotify-grace"
              label="Re-notification grace"
              unit="minutes"
              hint="How long a funded bonus is protected before the job can escalate again."
              error={errors.renotifyGraceMinutes?.message}
              register={register("renotifyGraceMinutes", {
                valueAsNumber: true,
              })}
            />
            <SpanField
              id="slot-reminder"
              label="Technician slot reminder"
              unit="minutes"
              hint="How long before a slot the assigned technician is pushed a reminder."
              error={errors.slotReminderMinutes?.message}
              register={register("slotReminderMinutes", {
                valueAsNumber: true,
              })}
            />
            <SpanField
              id="customer-notice"
              label="Technician details to customer"
              unit="minutes"
              hint="How long before a slot the customer is WhatsApped the technician's name and number."
              error={errors.customerNoticeMinutes?.message}
              register={register("customerNoticeMinutes", {
                valueAsNumber: true,
              })}
            />
            <SpanField
              id="sla-warn"
              label={'"Due soon" at'}
              unit="% of window left"
              hint="Below this much of the SLA window remaining, a ticket turns amber."
              error={errors.slaWarnAtPct?.message}
              register={register("slaWarnAtPct", { valueAsNumber: true })}
            />
          </FieldGroup>
        </RuleCard>

        {/* The bonus bands and the AI threshold share the second row: both are
            short, and pairing them leaves the two tall cards — the penalty
            bands and the clocks — level with each other on the first. */}
        <RuleCard title="Escalation bonus bands">
          <FieldSet>
            <FieldLegend className="sr-only">
              Bonus offered on re-notification
            </FieldLegend>
            <FieldGrid className="grid grid-cols-2 gap-3">
              {bonusFields.map((f, i) => {
                const err = errors.bonusAmounts?.[i]?.amount?.message;
                const id = `bonus-${i}`;
                return (
                  <Field key={f.id} data-invalid={err ? true : undefined}>
                    <FieldLabel htmlFor={id} required>
                      Band {i + 1}
                    </FieldLabel>
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${id}-error` : undefined}
                      {...register(`bonusAmounts.${i}.amount`, {
                        valueAsNumber: true,
                      })}
                    />
                    {err ? (
                      <FieldDescription
                        id={`${id}-error`}
                        role="alert"
                        className="text-danger"
                      >
                        {err}
                      </FieldDescription>
                    ) : null}
                  </Field>
                );
              })}
            </FieldGrid>
          </FieldSet>

          {/* Says where the money comes from, since the penalty card that
              collects it is no longer the neighbour saying so. */}
          <p className="mt-3.5 text-xs text-ink-3">
            The four chips a manager picks from when funding a re-notification
            on an escalated ticket. Paid to whoever accepts, out of the penalty
            pool above.
          </p>
        </RuleCard>

        {/* AI verification threshold — hidden while the AI slice is not built.
            UI only: `aiThreshold` is a real `company_rules` column the API
            still requires on save, so the field stays in the schema and in
            `toFormValues`/`toDraft`. Unregistered but present in
            `defaultValues`, it round-trips the server's own value untouched —
            saving this form never silently rewrites a rule nobody can see. */}
        {/* <RuleCard title="AI verification threshold">
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
        </RuleCard> */}

        {/* Its own card rather than a ninth row in "Timing", which measures
            every one of its values in hours or minutes. This one is metres. */}
        <RuleCard title="Proof location">
          <FieldGroup className="gap-3">
            <SpanField
              id="geo-radius"
              label="Site photo must be within"
              unit="metres"
              hint="How far from the customer's address the technician's live site photo may be taken."
              error={errors.geoRadiusM?.message}
              register={register("geoRadiusM", { valueAsNumber: true })}
            />
          </FieldGroup>
          <p className="mt-3.5 text-xs text-ink-3">
            Only applies to a ticket whose address was picked from the map at
            intake; one typed by hand is checked against its pincode instead.
            Keep this generous — the map pin is the building, not the door, and
            can sit a few hundred metres out on a large complex or a rural plot.
          </p>
        </RuleCard>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5">
        {/* The server is the authority — `PUT /settings/rules` carries
            `settings.edit` — so this only saves somebody a refused round trip
            and a message they could not have acted on. */}
        {!canEdit ? (
          <span className="mr-auto text-xs text-ink-3">
            You can view these rules but not change them.
          </span>
        ) : isDirty ? (
          <span className="mr-auto text-xs text-ink-3">Unsaved changes</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(toFormValues(rules))}
          disabled={!isDirty || isSaving || !canEdit}
        >
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || isSaving || !canEdit}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          Save configuration
        </Button>
      </div>
    </form>
  );
}

/** A number with its unit spelled beside it — hours, minutes or a percentage. */
function SpanField({
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
  register: ReturnType<ReturnType<typeof useForm<RulesFormValues>>["register"]>;
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
          min={1}
          className="w-28"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          {...register}
        />
        <span className="text-[13px] text-ink-2">{unit}</span>
      </div>
      {error ? (
        <FieldDescription
          id={`${id}-error`}
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : (
        <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
      )}
    </Field>
  );
}

/** Exported for `NodeRulesForm`, which renders the same six cards in override
 *  mode. Two consumers, so it stays here rather than moving to `shared/`. */
export function RuleCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
