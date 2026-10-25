import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChoiceCards } from "@/components/shared/ChoiceCards";
import { FieldGrid } from "@/components/shared/FieldGrid";
import {
  TYPE_OPTIONS,
  TYPE_WORD_TO_WIRE,
} from "@/components/technicians/technicianType";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  useSaveSpeedRule,
  useSpeedCatalogue,
} from "@/hooks/useAllowances";
import { useNodeTree } from "@/hooks/useProductMaster";
import type { AllowanceScope, SpeedRule } from "@/types/allowances";
import {
  fromProductTree,
  fromSpeedCatalogue,
  type PickNode,
} from "./pickTree";
import { targetLabel } from "./speedRows";
import {
  emptySpeedValues,
  speedRowSchema,
  toSpeedBody,
  toSpeedValues,
  type SpeedRowField,
  type SpeedRowValues,
} from "./speedSchema";
import { SpeedTargetPicker, type PickedTarget } from "./SpeedTargetPicker";

/**
 * Add or edit one speed rule (Task 11 S1).
 *
 * **The target is the key.** The PUT is an upsert on technician type + target,
 * so on EDIT both are locked — changing either would silently create a second
 * row and leave the first, which is the "delete and re-add" the doc scopes
 * out. On ADD a clash with an existing row is refused by the schema, not
 * overwritten.
 *
 * Mounted only while open (the dialog unmounts its content when closed), so
 * every opening starts from a fresh form. Closes on success only: a refusal is
 * the toaster's, and closing over it would hide what was refused.
 */
export function SpeedRuleDialog({
  open,
  onOpenChange,
  scope,
  rule,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: AllowanceScope;
  /** Present = edit this row; absent = add. */
  rule?: SpeedRule;
  /** The whole matrix, for the duplicate check. */
  existing: readonly SpeedRule[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit speed rule" : "Add speed rule"}</DialogTitle>
          <DialogDescription>
            Between the two, nothing is paid or charged. Set both amounts to 0
            to switch speed off for this product.
          </DialogDescription>
        </DialogHeader>
        <SpeedRuleForm
          scope={scope}
          rule={rule}
          existing={existing}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SpeedRuleForm({
  scope,
  rule,
  existing,
  onDone,
}: {
  scope: AllowanceScope;
  rule?: SpeedRule;
  existing: readonly SpeedRule[];
  onDone: () => void;
}) {
  const save = useSaveSpeedRule(scope);
  const [picking, setPicking] = useState(false);

  const schema = useMemo(
    () => speedRowSchema(existing, rule?.id),
    [existing, rule?.id]
  );
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<SpeedRowValues>({
    resolver: zodResolver(schema),
    defaultValues: rule ? toSpeedValues(rule) : emptySpeedValues(),
  });

  const values = useWatch({ control });
  const type = values.technicianType ?? "Freelancer";

  const onSubmit = async (v: SpeedRowValues) => {
    try {
      await save.mutateAsync(toSpeedBody(v));
      toast.add({ title: "Rule saved" });
      onDone();
    } catch {
      /* Toasted by the global handler; the dialog stays up. */
    }
  };

  const err = (name: SpeedRowField) => errors[name]?.message;

  const num = (
    name: SpeedRowField,
    label: string,
    inputMode: "numeric" = "numeric"
  ) => (
    <Field data-invalid={err(name) ? true : undefined}>
      <FieldLabel htmlFor={`speed-${name}`}>{label}</FieldLabel>
      <Input
        id={`speed-${name}`}
        inputMode={inputMode}
        aria-invalid={err(name) ? true : undefined}
        aria-describedby={err(name) ? `speed-${name}-error` : undefined}
        {...register(name)}
      />
      {err(name) ? (
        <FieldDescription
          id={`speed-${name}-error`}
          role="alert"
          className="text-danger"
        >
          {err(name)}
        </FieldDescription>
      ) : null}
    </Field>
  );

  const chosen =
    values.targetId && values.targetKind
      ? rule && values.targetId === rule.targetId
        ? targetLabel(rule)
        : (values.targetName ?? "")
      : null;

  return (
    <>
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      {/* Applies to — the target is the key, locked on edit. */}
      <Field data-invalid={err("targetId") ? true : undefined}>
        <FieldLabel>Applies to</FieldLabel>
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
          <span className="min-w-0 text-[13px] font-medium">
            {chosen ?? <span className="text-ink-3">—</span>}
          </span>
          {rule ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPicking(true)}
            >
              {chosen ? "Change" : "Choose category or product"}
            </Button>
          )}
        </div>
        {err("targetId") ? (
          <FieldDescription role="alert" className="text-danger">
            {err("targetId")}
          </FieldDescription>
        ) : null}
      </Field>

      <Controller
        control={control}
        name="technicianType"
        render={({ field }) => (
          <ChoiceCards
            legend="Technician type"
            options={TYPE_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            disabled={Boolean(rule)}
            description={
              rule
                ? "A rule's type and target are its key — remove it and add a new one to change them."
                : undefined
            }
          />
        )}
      />

      <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {num("rewardWithinHours", "Reward if finished within (hours)")}
        {num("rewardRupees", "Reward (₹)")}
        {num("penaltyAfterHours", "Penalty if finished after (hours)")}
        {num("penaltyRupees", "Penalty (₹)")}
      </FieldGrid>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save rule
        </Button>
      </DialogFooter>
    </form>

      {/* Outside the <form>: a portal's events still bubble through React's
          tree, and a picker click must never be able to reach the form. */}
      <TargetPickerDialog
        open={picking}
        onOpenChange={setPicking}
        scope={scope}
        isTaken={(kind, id) =>
          existing.some(
            (r) =>
              r.technicianType === TYPE_WORD_TO_WIRE[type] &&
              r.targetKind === kind &&
              r.targetId === id
          )
        }
        onChoose={(t) => {
          setValue("targetKind", t.kind, { shouldValidate: true });
          setValue("targetId", t.id, { shouldValidate: true });
          setValue("targetName", t.name, { shouldValidate: true });
          setPicking(false);
        }}
      />
    </>
  );
}

/** The nested dialog: the tree, from whichever door this surface may use. */
function TargetPickerDialog({
  open,
  onOpenChange,
  scope,
  isTaken,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: AllowanceScope;
  isTaken: (kind: "node" | "model", id: string) => boolean;
  onChoose: (target: PickedTarget) => void;
}) {
  const franchise = scope.kind === "franchise";
  // Both hooks always run; only the one this surface may call is enabled.
  // Franchise principals read the price-free catalogue (W16) and NEVER
  // `/masters/nodes`; staff read the master tree.
  const catalogue = useSpeedCatalogue({ enabled: open && franchise });
  const tree = useNodeTree(true, undefined, "catalogue", open && !franchise);
  const query = franchise ? catalogue : tree;

  const nodes = useMemo<PickNode[] | undefined>(() => {
    if (franchise) {
      return catalogue.data ? fromSpeedCatalogue(catalogue.data) : undefined;
    }
    return tree.data ? fromProductTree(tree.data) : undefined;
  }, [franchise, catalogue.data, tree.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose what this rule applies to</DialogTitle>
          <DialogDescription>
            A category covers every product beneath it.
          </DialogDescription>
        </DialogHeader>
        <SpeedTargetPicker
          nodes={nodes}
          isLoading={query.isLoading}
          error={query.isError ? query.error : null}
          onRetry={() => query.refetch()}
          isTaken={isTaken}
          onChoose={onChoose}
        />
      </DialogContent>
    </Dialog>
  );
}
