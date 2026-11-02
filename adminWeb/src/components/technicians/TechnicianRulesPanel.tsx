import { useMemo, useState } from "react";
import {
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Save } from "lucide-react";
import { ErrorState } from "@/components/shared/states";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  useSaveTechnicianRules,
  useTechnicianRules,
} from "@/hooks/useTechnicianRules";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import type { TechnicianRules } from "@/types/technicianRules";
import { TechnicianHoldingDialog } from "./TechnicianHoldingDialog";
import {
  BAND_COUNT,
  PENALTY_BAND_LABELS,
  inheritedValues,
  isOverridden,
  paiseToRupees,
  resetGroup,
  technicianRulesSchema,
  toFormValues,
  toRulesBody,
  type GroupKey,
  type RulesFormValues,
} from "./technicianRulesSchema";

/**
 * One technician's own rules (Epic 3): payout, cancellation penalties, bonus
 * chips, speed and travel, plus the redemption terms (minimum and holding).
 *
 * Every box that is EMPTY inherits — the placeholder and the caption under it
 * say what it inherits. Saving PUTs the whole set. Serves the staff console and
 * the franchise portal alike (the workspace adapter picks the door).
 *
 *   canEdit  the page's own gate (edit key AND `canManage`); the server
 *            refuses a write regardless (hard rule 8).
 *   canHold  holding is a payer's call: National Head and above on the staff
 *            door, the franchisee admin on the portal's.
 */
export function TechnicianRulesPanel({
  technicianId,
  canEdit,
  canHold,
}: {
  technicianId: string;
  canEdit: boolean;
  canHold: boolean;
}) {
  const query = useTechnicianRules(technicianId);

  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't load this technician's rules"
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (query.isLoading || !query.data) {
    return (
      <div className="grid gap-3.5" aria-busy="true">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  return (
    <RulesFields
      technicianId={technicianId}
      rules={query.data}
      canEdit={canEdit}
      canHold={canHold}
    />
  );
}

/* ------------------------------------------------------------------ pieces */

const chip = "rounded-full border px-2 py-0.5 text-[11px] font-semibold";

function GroupHeader({
  title,
  description,
  overridden,
  canEdit,
  onOverride,
  onReset,
}: {
  title: string;
  description: string;
  overridden: boolean;
  canEdit: boolean;
  /** Absent when there is nothing inherited to start from (speed). */
  onOverride?: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
            {title}
          </h3>
          {overridden ? (
            <span className={`${chip} border-info/30 bg-info-bg text-info`}>
              Overridden
            </span>
          ) : (
            <span className={`${chip} border-line bg-surface-3 text-ink-2`}>
              Inherited
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-3">{description}</p>
      </div>
      {canEdit ? (
        overridden ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onReset}
          >
            Reset to inherited
          </Button>
        ) : onOverride ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onOverride}
          >
            Override
          </Button>
        ) : null
      ) : null}
    </div>
  );
}

function Box({
  id,
  label,
  placeholder,
  inherited,
  error,
  readOnly,
  inputMode = "numeric",
  registration,
}: {
  id: string;
  label: string;
  placeholder?: string;
  /** Caption under the box while it is empty, e.g. "Inherited: ₹300". */
  inherited?: string;
  error?: string;
  readOnly: boolean;
  inputMode?: "numeric" | "decimal";
  registration: ReturnType<UseFormRegister<RulesFormValues>>;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode={inputMode}
        disabled={readOnly}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : inherited ? `${id}-hint` : undefined}
        {...registration}
      />
      {error ? (
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : inherited ? (
        <FieldDescription id={`${id}-hint`}>{inherited}</FieldDescription>
      ) : null}
    </Field>
  );
}

/* ------------------------------------------------------------------- form */

function RulesFields({
  technicianId,
  rules,
  canEdit,
  canHold,
}: {
  technicianId: string;
  rules: TechnicianRules;
  canEdit: boolean;
  canHold: boolean;
}) {
  const save = useSaveTechnicianRules(technicianId);
  // Re-syncs when the server's copy changes (after a save); react-query keeps
  // the reference stable between identical reads.
  const values = useMemo(() => toFormValues(rules), [rules]);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useForm<RulesFormValues>({
    resolver: zodResolver(technicianRulesSchema),
    values,
  });
  const current = useWatch({ control }) as RulesFormValues;
  const readOnly = !canEdit;

  const onSubmit = async (v: RulesFormValues) => {
    try {
      await save.mutateAsync(toRulesBody(v));
      toast.add({ title: "Rules saved" });
    } catch {
      /* The global handler has toasted it; what was typed stays. */
    }
  };

  const reset = (group: GroupKey) => {
    const next = resetGroup(getValues(), group);
    (Object.keys(next) as (keyof RulesFormValues)[]).forEach((k) => {
      setValue(k, next[k] as never, { shouldDirty: true });
    });
  };
  const override = (keys: (keyof ReturnType<typeof inheritedValues>)[]) => {
    const inh = inheritedValues(rules);
    keys.forEach((k) => setValue(k, inh[k] as never, { shouldDirty: true }));
  };

  const isEmployee = rules.technicianType === "employee";
  const inh = rules.inherited;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-3.5">
      <div className="flex gap-2.5 rounded-lg border border-info/30 bg-info-bg px-3 py-2.5 text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-[12px] text-ink-2">
          Changes apply to jobs this technician accepts from now on. Jobs already
          accepted keep the terms they were accepted under.
        </p>
      </div>
      {readOnly ? (
        <p className="text-xs text-ink-3">
          You can see these terms but not change them.
        </p>
      ) : null}

      {/* Payout */}
      <Card>
        <CardContent>
          <GroupHeader
            title="Payout"
            description="Percent of the product's payout this technician is paid per job. 100% is the product's payout."
            overridden={isOverridden(current, "payout")}
            canEdit={canEdit}
            onOverride={() => override(["payoutPercent"])}
            onReset={() => reset("payout")}
          />
          <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Box
              id="rules-payout"
              label="Payout (%)"
              placeholder={String(inh.payoutPercent)}
              inherited={`Inherited: ${inh.payoutPercent}%`}
              error={errors.payoutPercent?.message}
              readOnly={readOnly}
              registration={register("payoutPercent")}
            />
          </FieldGrid>
          {isEmployee ? (
            <p className="mt-3 rounded-md bg-surface-3 px-3 py-2 text-xs text-ink-2">
              Employees get no per-job payout, so this percentage does not apply
              to them.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Cancellation penalties */}
      <Card>
        <CardContent>
          <GroupHeader
            title="Cancellation penalties"
            description="What this technician is charged for cancelling, by how late. Fill all four, or none."
            overridden={isOverridden(current, "penalties")}
            canEdit={canEdit}
            onOverride={() => override(["penalties"])}
            onReset={() => reset("penalties")}
          />
          <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: BAND_COUNT }, (_, i) => (
              <Box
                key={i}
                id={`rules-penalty-${i}`}
                label={`${PENALTY_BAND_LABELS[i]} (₹)`}
                placeholder={paiseToRupees(inh.cancelPenaltiesPaise[i])}
                inherited={`Inherited: ${moneyPaise(inh.cancelPenaltiesPaise[i])}`}
                error={errors.penalties?.[i]?.message}
                readOnly={readOnly}
                inputMode="decimal"
                registration={register(`penalties.${i}`)}
              />
            ))}
          </FieldGrid>
        </CardContent>
      </Card>

      {/* Bonus chips */}
      <Card>
        <CardContent>
          <GroupHeader
            title="Bonus chips"
            description="The four bonus amounts a manager can offer this technician on a re-notified job. Fill all four, or none."
            overridden={isOverridden(current, "bonuses")}
            canEdit={canEdit}
            onOverride={() => override(["bonuses"])}
            onReset={() => reset("bonuses")}
          />
          <FieldGrid className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: BAND_COUNT }, (_, i) => (
              <Box
                key={i}
                id={`rules-bonus-${i}`}
                label={`Chip ${i + 1} (₹)`}
                placeholder={paiseToRupees(inh.bonusBandsPaise[i])}
                inherited={`Inherited: ${moneyPaise(inh.bonusBandsPaise[i])}`}
                error={errors.bonuses?.[i]?.message}
                readOnly={readOnly}
                inputMode="decimal"
                registration={register(`bonuses.${i}`)}
              />
            ))}
          </FieldGrid>
        </CardContent>
      </Card>

      {/* Speed */}
      <Card>
        <CardContent>
          <GroupHeader
            title="Speed"
            description="A reward for a fast job and a charge for a slow one. All four fields, or none."
            overridden={isOverridden(current, "speed")}
            canEdit={canEdit}
            onReset={() => reset("speed")}
          />
          <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Box
              id="rules-speed-reward-hours"
              label="Fast if done within (hours)"
              error={errors.speedRewardHours?.message}
              readOnly={readOnly}
              registration={register("speedRewardHours")}
            />
            <Box
              id="rules-speed-reward"
              label="Reward (₹)"
              error={errors.speedRewardRupees?.message}
              readOnly={readOnly}
              inputMode="decimal"
              registration={register("speedRewardRupees")}
            />
            <Box
              id="rules-speed-penalty-hours"
              label="Slow if done after (hours)"
              error={errors.speedPenaltyHours?.message}
              readOnly={readOnly}
              registration={register("speedPenaltyHours")}
            />
            <Box
              id="rules-speed-penalty"
              label="Penalty (₹)"
              error={errors.speedPenaltyRupees?.message}
              readOnly={readOnly}
              inputMode="decimal"
              registration={register("speedPenaltyRupees")}
            />
          </FieldGrid>
          <p className="mt-3 rounded-md bg-surface-3 px-3 py-2 text-xs text-ink-2">
            {isOverridden(current, "speed")
              ? "These terms replace the franchisee's speed rules for every product this technician does."
              : "Empty: the franchisee's speed rules for each category and product apply. Setting these replaces them for every product."}
          </p>
        </CardContent>
      </Card>

      {/* Travel */}
      <Card>
        <CardContent>
          <GroupHeader
            title="Travel allowance"
            description="Paid for distance beyond a free allowance. Leave a box empty to use the franchisee's figure."
            overridden={isOverridden(current, "travel")}
            canEdit={canEdit}
            onOverride={() =>
              override(["travelFreeKm", "travelPerStepRupees", "travelMaxRupees"])
            }
            onReset={() => reset("travel")}
          />
          <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Box
              id="rules-travel-free"
              label="Free distance (km)"
              placeholder={String(inh.travel.freeKm)}
              inherited={`Inherited: ${inh.travel.freeKm} km`}
              error={errors.travelFreeKm?.message}
              readOnly={readOnly}
              registration={register("travelFreeKm")}
            />
            <Box
              id="rules-travel-step"
              label="Amount per step (₹)"
              placeholder={paiseToRupees(inh.travel.paisePerStep)}
              inherited={`Inherited: ${moneyPaise(inh.travel.paisePerStep)}`}
              error={errors.travelPerStepRupees?.message}
              readOnly={readOnly}
              inputMode="decimal"
              registration={register("travelPerStepRupees")}
            />
            <Box
              id="rules-travel-max"
              label="Most per job (₹)"
              placeholder={paiseToRupees(inh.travel.maxPaisePerJob)}
              inherited={`Inherited: ${moneyPaise(inh.travel.maxPaisePerJob)}`}
              error={errors.travelMaxRupees?.message}
              readOnly={readOnly}
              inputMode="decimal"
              registration={register("travelMaxRupees")}
            />
          </FieldGrid>
        </CardContent>
      </Card>

      <RedemptionControls
        technicianId={technicianId}
        rules={rules}
        canEdit={canEdit}
        canHold={canHold}
        control={control}
        register={register}
        errors={errors}
      />

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || !isDirty}>
            {save.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" aria-hidden />
            )}
            Save rules
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/* --------------------------------------------------- redemption controls */

function RedemptionControls({
  technicianId,
  rules,
  canEdit,
  canHold,
  control,
  register,
  errors,
}: {
  technicianId: string;
  rules: TechnicianRules;
  canEdit: boolean;
  canHold: boolean;
  control: Control<RulesFormValues>;
  register: UseFormRegister<RulesFormValues>;
  errors: FieldErrors<RulesFormValues>;
}) {
  const [holdOpen, setHoldOpen] = useState(false);
  const typed = useWatch({ control, name: "minRedeemableRupees" });
  const held = rules.holdingPaise;

  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
            Redemption controls
          </h3>
          {held > 0 ? (
            <span className={`${chip} border-warn/30 bg-warn-bg text-warn`}>
              {moneyPaise(held)} on hold
            </span>
          ) : null}
        </div>

        <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Box
            id="rules-min-redeemable"
            label="Minimum redeemable (₹)"
            inherited={
              typed.trim() === ""
                ? "Empty: no minimum. They can redeem any amount."
                : "They can redeem only once at least this much is available. Saved with the rules above."
            }
            error={errors.minRedeemableRupees?.message}
            readOnly={!canEdit}
            inputMode="decimal"
            registration={register("minRedeemableRupees")}
          />
        </FieldGrid>

        <div className="mt-4 border-t border-line-2 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">
                Holding: {moneyPaise(held)}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                Held back from what they can redeem. It stays theirs on the
                ledger. Saved on its own, with a reason.
              </p>
            </div>
            {canHold ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHoldOpen(true)}
              >
                Set / change holding
              </Button>
            ) : null}
          </div>

          <HoldingHistory history={rules.holdingHistory} />
        </div>

        {canHold ? (
          <TechnicianHoldingDialog
            open={holdOpen}
            onOpenChange={setHoldOpen}
            technicianId={technicianId}
            currentPaise={held}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function HoldingHistory({ history }: { history: TechnicianRules["holdingHistory"] }) {
  if (history.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-ink-2">No holding has been set for them.</p>
    );
  }
  return (
    <ol className="mt-3 grid gap-3">
      {history.map((h) => (
        <li
          key={h.id}
          className="grid gap-0.5 border-b border-line-2 pb-3 last:border-0 last:pb-0"
        >
          <p className="text-[13px] font-medium">
            {moneyPaise(h.oldPaise)} → {moneyPaise(h.newPaise)}
          </p>
          <p className="text-xs text-ink-2">{h.reason}</p>
          <p className="text-xs text-ink-3">
            {h.actorLabel ?? "—"} · {formatDateTime(h.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}
