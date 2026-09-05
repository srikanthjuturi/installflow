import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
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
import { RuleCard } from "./RulesForm";
import {
  nodeRulesSchema,
  overridesAnything,
  toNodeFormValues,
  type NodeRulesFormValues,
} from "./nodeRulesSchema";
import type { NodeRuleField, NodeRulesConfig } from "@/services/settings";

/**
 * One category's overrides of the operating rules.
 *
 * The same six cards `RulesForm` draws, with one difference that changes every
 * field: **an empty box means inherit**, and the value it would inherit is the
 * placeholder. So the screen reads as "this is what happens here, and these are
 * the ones we have changed" rather than as a second copy of the whole config.
 *
 * A separate component rather than a mode on `RulesForm`, and the reason is the
 * inputs rather than the layout: every box there is a required `valueAsNumber`,
 * every box here is an optional string that has to tell "" apart from 0. A
 * shared component would be a conditional at every field. They share `RuleCard`
 * and their card titles, which is the part that actually is the same.
 */
/** The two rules that are a LIST of four rather than one number. */
type BandList = "penalty" | "bonusAmounts";

interface NodeRulesFormProps {
  config: NodeRulesConfig;
  onSubmit: (values: NodeRulesFormValues) => void;
  onReset: () => void;
  isSaving: boolean;
}

export function NodeRulesForm({
  config,
  onSubmit,
  onReset,
  isSaving,
}: NodeRulesFormProps) {
  const { has } = useFeatureAccess();
  const canEdit = has("settings.edit");

  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useForm<NodeRulesFormValues>({
    resolver: zodResolver(nodeRulesSchema),
    defaultValues: toNodeFormValues(config),
  });

  const { fields } = useFieldArray({ control, name: "penalty" });
  const { fields: bonusFields } = useFieldArray({
    control,
    name: "bonusAmounts",
  });

  const effective = config.effective;
  const hasOverrides = overridesAnything(config.own);

  /** "300, from Company default" / "400, from TV" — under every empty box. */
  const source = (field: NodeRuleField) =>
    config.inheritedFrom[field] ?? "Company default";

  /**
   * Has this list been committed as an override yet?
   *
   * A band list is stored whole, so setting ONE band necessarily sets four —
   * and until this existed, the form said so by rejecting the other three.
   * Which read as a lie: their inherited figures were sitting right there as
   * placeholders, so the boxes looked full and the error looked like a bug.
   *
   * They are carried in for real the moment the first band is typed into.
   * ONE-SHOT, tracked here rather than derived from "is any box filled",
   * because a derived version fights the user on the way back out: clearing
   * the four one at a time would see the first empty box and helpfully refill
   * it. Once carried, the boxes are ordinary — edit any, and `Clear all four`
   * is the way back to inheriting.
   */
  const [carried, setCarried] = useState(() => ({
    penalty: config.own.penalty !== null,
    bonusAmounts: config.own.bonusAmounts !== null,
  }));

  /** Fill this list's empty boxes from what they inherit. Once per list. */
  const carry = (list: BandList, amountAt: (i: number) => number) => () => {
    if (carried[list]) return;
    setCarried((prev) => ({ ...prev, [list]: true }));
    getValues(list).forEach((row, i) => {
      if (row.amount.trim() === "") {
        setValue(`${list}.${i}.amount`, String(amountAt(i)), {
          shouldDirty: true,
        });
      }
    });
  };

  /** Back to inheriting, in one click rather than four deletions. */
  const clearBands = (list: BandList) => () => {
    setCarried((prev) => ({ ...prev, [list]: false }));
    getValues(list).forEach((_, i) => {
      setValue(`${list}.${i}.amount`, "", { shouldDirty: true });
    });
  };

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
                const id = `node-penalty-${i}`;
                return (
                  <Field key={f.id} data-invalid={err ? true : undefined}>
                    <FieldLabel htmlFor={id}>
                      {effective.penalty[i]?.band ?? `Band ${i + 1}`}
                    </FieldLabel>
                    <Input
                      id={id}
                      inputMode="numeric"
                      // The inherited figure as the placeholder — so an empty
                      // box shows what actually happens rather than looking
                      // unset.
                      placeholder={String(effective.penalty[i]?.amount ?? "")}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={`${id}-hint`}
                      disabled={!canEdit}
                      {...register(`penalty.${i}.amount`, {
                        onChange: carry(
                          "penalty",
                          (n) => effective.penalty[n]?.amount ?? 0
                        ),
                      })}
                    />
                    <FieldDescription
                      id={`${id}-hint`}
                      role={err ? "alert" : undefined}
                      className={err ? "text-danger" : undefined}
                    >
                      {err ?? `Inherits ₹${effective.penalty[i]?.amount} from ${source("penalty")}`}
                    </FieldDescription>
                  </Field>
                );
              })}
              <BandNote
                carried={carried.penalty}
                canEdit={canEdit}
                onClear={clearBands("penalty")}
                source={source("penalty")}
              >
                All four or none — a band list is overridden whole. Type into
                one and the rest are filled in from what they inherit. The
                monthly cap stays on Company default: it limits a technician
                across every job they took, so it cannot differ per product.
              </BandNote>
            </FieldGroup>
          </FieldSet>
        </RuleCard>

        <RuleCard title="Escalation bonus bands">
          <FieldSet>
            <FieldLegend className="sr-only">Bonus amount per band</FieldLegend>
            <FieldGroup className="gap-3">
              {bonusFields.map((f, i) => {
                const err = errors.bonusAmounts?.[i]?.amount?.message;
                const id = `node-bonus-${i}`;
                return (
                  <Field key={f.id} data-invalid={err ? true : undefined}>
                    <FieldLabel htmlFor={id}>Band {i + 1}</FieldLabel>
                    <Input
                      id={id}
                      inputMode="numeric"
                      placeholder={String(effective.bonusAmounts[i] ?? "")}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={`${id}-hint`}
                      disabled={!canEdit}
                      {...register(`bonusAmounts.${i}.amount`, {
                        onChange: carry(
                          "bonusAmounts",
                          (n) => effective.bonusAmounts[n] ?? 0
                        ),
                      })}
                    />
                    <FieldDescription
                      id={`${id}-hint`}
                      role={err ? "alert" : undefined}
                      className={err ? "text-danger" : undefined}
                    >
                      {err ??
                        `Inherits ₹${effective.bonusAmounts[i]} from ${source("bonusAmounts")}`}
                    </FieldDescription>
                  </Field>
                );
              })}
              <BandNote
                carried={carried.bonusAmounts}
                canEdit={canEdit}
                onClear={clearBands("bonusAmounts")}
                source={source("bonusAmounts")}
              >
                What the escalation screen offers for a job in this category.
                All four or none — type into one and the rest are filled in from
                what they inherit.
              </BandNote>
            </FieldGroup>
          </FieldSet>
        </RuleCard>

        <RuleCard title="Timing">
          <FieldGroup className="gap-3">
            <SpanField
              id="node-slot-confirm"
              label="Slot-confirm timeout"
              unit="hours"
              inherited={effective.slotConfirmTimeoutHours}
              from={source("slotConfirmTimeoutHours")}
              error={errors.slotConfirmTimeoutHours?.message}
              disabled={!canEdit}
              {...register("slotConfirmTimeoutHours")}
            />
            <SpanField
              id="node-escalation"
              label="Escalation trigger"
              unit="hours before the slot"
              inherited={effective.escalationTriggerHours}
              from={source("escalationTriggerHours")}
              error={errors.escalationTriggerHours?.message}
              disabled={!canEdit}
              {...register("escalationTriggerHours")}
            />
            <SpanField
              id="node-customer-wait"
              label="Customer wait period"
              unit="hours"
              inherited={effective.customerWaitHours}
              from={source("customerWaitHours")}
              error={errors.customerWaitHours?.message}
              disabled={!canEdit}
              {...register("customerWaitHours")}
            />
            <SpanField
              id="node-renotify"
              label="Re-notification grace"
              unit="minutes"
              inherited={effective.renotifyGraceMinutes}
              from={source("renotifyGraceMinutes")}
              error={errors.renotifyGraceMinutes?.message}
              disabled={!canEdit}
              {...register("renotifyGraceMinutes")}
            />
            <SpanField
              id="node-slot-reminder"
              label="Slot reminder"
              unit="minutes before the slot"
              inherited={effective.slotReminderMinutes}
              from={source("slotReminderMinutes")}
              error={errors.slotReminderMinutes?.message}
              disabled={!canEdit}
              {...register("slotReminderMinutes")}
            />
            <SpanField
              id="node-customer-notice"
              label="Customer notice"
              unit="minutes before the slot"
              inherited={effective.customerNoticeMinutes}
              from={source("customerNoticeMinutes")}
              error={errors.customerNoticeMinutes?.message}
              disabled={!canEdit}
              {...register("customerNoticeMinutes")}
            />
            <SpanField
              id="node-sla-warn"
              label="Due soon at"
              unit="% of the window remaining"
              inherited={effective.slaWarnAtPct}
              from={source("slaWarnAtPct")}
              error={errors.slaWarnAtPct?.message}
              disabled={!canEdit}
              {...register("slaWarnAtPct")}
            />
          </FieldGroup>
        </RuleCard>

        <RuleCard title="Verification">
          <FieldGroup className="gap-3">
            {/* AI confidence threshold — hidden with the company-level slider
                in `RulesForm`. The override still resolves and still saves:
                unregistered, its `defaultValues` entry carries this node's own
                value (or "" for inherit) straight back through `toNodeDraft`. */}
            {/* <SpanField
              id="node-ai-threshold"
              label="AI confidence threshold"
              unit="percent"
              inherited={effective.ai.threshold}
              from={source("aiThreshold")}
              error={errors.aiThreshold?.message}
              disabled={!canEdit}
              {...register("aiThreshold")}
            /> */}
            <SpanField
              id="node-geo-radius"
              label="Proof radius"
              unit="metres from the address"
              inherited={effective.geoRadiusM}
              from={source("geoRadiusM")}
              error={errors.geoRadiusM?.message}
              disabled={!canEdit}
              {...register("geoRadiusM")}
            />
          </FieldGroup>
        </RuleCard>
      </div>

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
          {hasOverrides ? (
            <Button
              type="button"
              variant="outline"
              onClick={onReset}
              disabled={isSaving}
            >
              Reset to inherited
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => reset()}
            disabled={!isDirty || isSaving}
          >
            Undo changes
          </Button>
          <Button type="submit" disabled={!isDirty || isSaving}>
            {isSaving ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/**
 * The line under a band list: what the rule is, or what it now costs you.
 *
 * Once a list is carried in, the four boxes stop following their source — the
 * whole list is this category's. That is not a detail to leave somebody to
 * discover the next time the company default moves and this category does not
 * follow, so it is said here, next to the one button that undoes it.
 */
function BandNote({
  carried,
  canEdit,
  onClear,
  source,
  children,
}: {
  carried: boolean;
  canEdit: boolean;
  onClear: () => void;
  /** Where the list inherits from, named in the warning. */
  source: string;
  children: React.ReactNode;
}) {
  if (!carried) return <FieldDescription>{children}</FieldDescription>;

  return (
    <FieldDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        All four are set on this category and no longer follow {source}.
      </span>
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClear}
        >
          Clear all four
        </Button>
      ) : null}
    </FieldDescription>
  );
}

/**
 * One optional number, with what it inherits underneath.
 *
 * Takes the `register` result by spread, so the ref reaches the input — the
 * same shape `RulesForm.SpanField` uses.
 */
function SpanField({
  id,
  label,
  unit,
  inherited,
  from,
  error,
  ...field
}: {
  id: string;
  label: string;
  unit: string;
  inherited: number;
  from: string;
  error?: string;
} & React.ComponentProps<typeof Input>) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={String(inherited)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        {...field}
      />
      <FieldDescription
        id={`${id}-hint`}
        role={error ? "alert" : undefined}
        className={error ? "text-danger" : undefined}
      >
        {error ?? `Inherits ${inherited} ${unit} from ${from}`}
      </FieldDescription>
    </Field>
  );
}
