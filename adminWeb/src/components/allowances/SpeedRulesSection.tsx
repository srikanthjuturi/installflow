import { useState } from "react";
import { useSearchParams } from "react-router";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useDeleteSpeedRule, useSpeedRules } from "@/hooks/useAllowances";
import type { AllowanceScope, SpeedRule } from "@/types/allowances";
import { SpeedMatrixTable, type SpeedTypeFilter } from "./SpeedMatrixTable";
import { SpeedRuleDialog } from "./SpeedRuleDialog";
import { speedRowView } from "./speedRows";

const TYPE_PARAM = "type";

const asType = (v: string | null): SpeedTypeFilter =>
  v === "employee" || v === "freelancer" ? v : "all";

const TYPE_WORD = { employee: "Employees", freelancer: "Freelancers" } as const;

/**
 * The speed view: intro, the matrix, and the two dialogs it owns.
 *
 * The page owns the one open dialog (the `EscalationQueuePage` rule), so a long
 * matrix does not mount a dialog and a mutation hook per row. The Technician
 * type filter is `?type=` in the URL, merged onto the query string so it
 * survives `?view=speed`.
 */
export function SpeedRulesSection({
  scope,
  readOnly,
}: {
  scope: AllowanceScope;
  readOnly: boolean;
}) {
  const rules = useSpeedRules(scope);
  const remove = useDeleteSpeedRule(scope);
  const [searchParams, setSearchParams] = useSearchParams();
  const type = asType(searchParams.get(TYPE_PARAM));

  // The open flag and the subject are separate on purpose: clearing the rule
  // the instant the dialog starts to close would flip "Edit" to "Add" (and the
  // confirm's title to its fallback) mid-animation.
  const [editOpen, setEditOpen] = useState(false);
  const [editRule, setEditRule] = useState<SpeedRule | undefined>(undefined);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState<SpeedRule | null>(null);

  const onType = (next: SpeedTypeFilter) => {
    const url = new URLSearchParams(searchParams);
    if (next === "all") url.delete(TYPE_PARAM);
    else url.set(TYPE_PARAM, next);
    setSearchParams(url, { replace: true });
  };

  return (
    <>
      <p className="mb-3.5 text-[13px] leading-relaxed text-ink-2">
        Finish fast, earn a reward; finish late, pay a penalty. The clock runs
        from the start of the job&apos;s time slot (or from accepting it, if
        that is later) to pressing Complete, minus time waiting for a part. A
        product&apos;s rule beats its category&apos;s, and the deepest category
        wins.
      </p>

      <SpeedMatrixTable
        rows={rules.data}
        isLoading={rules.isLoading}
        error={rules.isError ? rules.error : null}
        onRetry={() => rules.refetch()}
        readOnly={readOnly}
        type={type}
        onType={onType}
        onAdd={() => {
          setEditRule(undefined);
          setEditOpen(true);
        }}
        onEdit={(rule) => {
          setEditRule(rule);
          setEditOpen(true);
        }}
        onRemove={(rule) => {
          setRemoving(rule);
          setRemoveOpen(true);
        }}
      />

      {readOnly ? null : (
        <>
          {/* Mounted for as long as the page is: the dialog unmounts its own
              content on close, so it still opens a fresh form each time. */}
          <SpeedRuleDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            scope={scope}
            rule={editRule}
            existing={rules.data ?? []}
          />

          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title={
              removing
                ? `Remove the rule for ${speedRowView(removing).target} (${TYPE_WORD[removing.technicianType]})?`
                : "Remove this rule?"
            }
            description="Jobs accepted from now on stop earning or paying for speed here. Jobs already accepted keep their rule."
            confirmLabel="Remove rule"
            isPending={remove.isPending}
            onConfirm={() => {
              if (!removing) return;
              remove.mutate(removing.id, {
                onSuccess: () => {
                  toast.add({ title: "Rule removed" });
                  setRemoveOpen(false);
                },
              });
            }}
          />
        </>
      )}
    </>
  );
}
