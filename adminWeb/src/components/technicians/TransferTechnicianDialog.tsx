import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFranchisee, useFranchiseeOptions } from "@/hooks/useFranchisees";
import { useTransferPreview, useTransferTechnician } from "@/hooks/useTechnicians";
import type { Technician, TransferBlocker } from "@/types/technician";
import { CoverageFields } from "./CoverageFields";
import {
  MAX_REASON,
  canConfirm,
  coverageSummary,
  hasNoAdmin,
  nothingInsideRange,
  rangeMatcher,
  reasonProblem,
  targetOptions,
} from "./transferPlan";

/** More than this many franchisees and a select becomes a search box (Task 08). */
const COMBOBOX_ABOVE = 10;
/** Chips shown per group; the rest are counted, not drawn. */
const CHIP_CAP = 60;

/**
 * Move one technician to another franchisee (Task 17 §5.2).
 *
 * Opens idle. Choosing a franchisee asks the server for a PREVIEW
 * (`?dryRun=true`) and everything on screen under "Where they will work" is that
 * answer — the console derives none of it. **Move** stays disabled until the
 * preview is back, clean, current (not mid-refresh) and the reason is at least
 * five characters.
 *
 * The ordinary case is that the move keeps NOTHING: franchisee areas are
 * disjoint and a technician covers their own franchisee's area. The preview then
 * answers "none of their pincodes is inside", and the dialog opens the picker by
 * itself (limited to the target's area) and re-previews with the pincodes chosen
 * — it is a step of the normal flow, not an error.
 *
 * `pincodes` is sent only when the person chose some; omitted, the server keeps
 * what is inside the range. An apply the preview could not foresee (somebody
 * took a job in between) lands as a sentence above the footer and the preview
 * runs again; the toaster reports it too (hard rule 9).
 *
 * Mounted only while open, so every opening starts idle.
 */
export function TransferTechnicianDialog({
  open,
  onOpenChange,
  technician,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: Technician;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <TransferForm
          technician={technician}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TransferForm({
  technician,
  onDone,
}: {
  technician: Technician;
  onDone: () => void;
}) {
  const { has } = useFeatureAccess();
  const franchisees = useFranchiseeOptions({ enabled: has("franchisees.view") });
  const apply = useTransferTechnician();

  const [toId, setToId] = useState("");
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [custom, setCustom] = useState(false);
  const [regionId, setRegionId] = useState(technician.regionId);
  const [picked, setPicked] = useState<string[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

  const options = useMemo(
    () => targetOptions(franchisees.data ?? [], technician.franchiseeId),
    [franchisees.data, technician.franchiseeId]
  );
  const target = (franchisees.data ?? []).find((f) => f.id === toId);

  const choose = (id: string) => {
    setToId(id);
    // Picks belong to the franchisee they were made for.
    setPicked([]);
    setCustom(false);
    setApplyError(null);
  };
  // One franchisee to move to is not a choice (hard rule 10).
  useAutoSelectSingle(
    options.filter((o) => !o.disabled).map((o) => o.value),
    toId,
    choose,
    !franchisees.isLoading
  );

  // The key and the request are one string. Debounced, so choosing several
  // pincodes in a row is one question, not one each.
  const liveKey = custom ? [...picked].sort().join(",") : "";
  const pincodesKey = useDebouncedValue(liveKey);
  const settling = liveKey !== pincodesKey;

  const preview = useTransferPreview(technician.id, toId, pincodesKey, {
    // Never re-ask while the move is being made: the move invalidates this very
    // query, and a refetch then would answer "already works for…".
    enabled: !apply.isPending,
  });
  // An answer about a different franchisee is not an answer for this one.
  const current =
    preview.data && preview.data.toFranchiseeId === toId ? preview.data : undefined;
  const checking = Boolean(toId) && (preview.isFetching || settling);
  const busy = apply.isPending || checking;

  // The ordinary case: nothing of theirs is inside — open the picker. Adjusting
  // state while rendering, guarded, is React's own idiom for "derived once".
  const nothingInside = nothingInsideRange(current);
  if (nothingInside && !custom) setCustom(true);

  const detail = useFranchisee(custom && target && !target.isHome ? toId : "");
  const matches = useMemo(
    () => (detail.data ? rangeMatcher(detail.data.pincodeRanges) : null),
    [detail.data]
  );
  const limitTo =
    target && matches ? { franchisee: target.name, matches } : undefined;

  const name = technician.name;
  const fromName = technician.franchiseeName;
  const toName = target?.name;
  const problem = reasonProblem(reason, name);
  const confirmable = canConfirm(current, reason, busy);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmable || !target) return;
    setApplyError(null);
    try {
      await apply.mutateAsync({
        id: technician.id,
        body: {
          franchiseeId: toId,
          reason: reason.trim(),
          // Only what the person chose — omitted, the server keeps what is
          // inside the range.
          ...(custom && picked.length > 0 ? { pincodes: picked } : {}),
        },
      });
      toast.add({ title: `${name} now works for ${target.name}` });
      onDone();
    } catch (err) {
      // The global handler has toasted it; the sentence also sits where the
      // person is looking, and the preview is asked again.
      setApplyError(
        err instanceof Error ? err.message : "Couldn't move this technician."
      );
      void preview.refetch();
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Move {name} to another franchisee</DialogTitle>
        <DialogDescription>
          {name} works for {fromName} today. After the move they are offered{" "}
          {toName ? `${toName}'s` : "the new franchisee's"} jobs instead, and{" "}
          {toName ?? "the new franchisee"} manages and pays them.
        </DialogDescription>
      </DialogHeader>

      <p className="text-[13px] text-ink-2">
        They keep their categories, daily limit, base location, UPI details,
        language and sign-in. Jobs and money already earned stay with {fromName}.
      </p>

      <Field>
        <FieldLabel htmlFor="transfer-to" required>
          Move to
        </FieldLabel>
        {franchisees.isLoading ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : franchisees.isError ? (
          <div role="alert" className="flex items-center gap-2 text-[13px] text-danger">
            Couldn&apos;t load the franchisees.
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void franchisees.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : options.length > COMBOBOX_ABOVE ? (
          <Combobox
            id="transfer-to"
            value={
              target
                ? options.find((o) => o.value === toId) ?? null
                : null
            }
            onValueChange={(o: ComboboxOption | null) => choose(o?.value ?? "")}
            options={options}
            placeholder="Choose a franchisee"
            emptyMessage="No franchisee matches that"
            disabled={apply.isPending}
          />
        ) : (
          <Select
            value={toId}
            onValueChange={(v) => choose(v ? String(v) : "")}
            disabled={apply.isPending}
          >
            <SelectTrigger id="transfer-to" className="w-full">
              <SelectValue placeholder="Choose a franchisee">
                {() =>
                  options.find((o) => o.value === toId)?.label ??
                  "Choose a franchisee"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field data-invalid={reasonTouched && problem ? true : undefined}>
        <FieldLabel htmlFor="transfer-reason" required>
          Why is {name} moving?
        </FieldLabel>
        <Textarea
          id="transfer-reason"
          value={reason}
          maxLength={MAX_REASON}
          disabled={apply.isPending}
          placeholder={`e.g. Moved to the east side of the city, which ${toName ?? "the new franchisee"} now covers`}
          aria-invalid={reasonTouched && problem ? true : undefined}
          aria-describedby="transfer-reason-hint"
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setReasonTouched(true)}
        />
        {reasonTouched && problem ? (
          <FieldDescription
            id="transfer-reason-hint"
            role="alert"
            className="text-danger"
          >
            {problem}
          </FieldDescription>
        ) : (
          <FieldDescription id="transfer-reason-hint">
            Kept on their record. At least 5 characters.
          </FieldDescription>
        )}
      </Field>

      {toId ? (
        <section aria-labelledby="transfer-coverage" className="grid gap-3">
          <h3
            id="transfer-coverage"
            className="text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase"
          >
            Where they will work
          </h3>

          {preview.isError && !current ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] text-danger"
            >
              <XCircle className="size-4 shrink-0" aria-hidden />
              Couldn&apos;t check that move.
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void preview.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : !current ? (
            <div aria-busy="true" className="grid gap-2">
              <p className="text-[13px] text-ink-2">Checking what would change…</p>
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : (
            <div
              aria-busy={checking || undefined}
              className={checking ? "grid gap-3 opacity-60" : "grid gap-3"}
            >
              {checking ? (
                <p className="text-[13px] text-ink-2">Checking what would change…</p>
              ) : null}

              {current.blockers.length === 0 ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok-bg px-3 py-2 text-[13px] font-medium text-ok"
                >
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                  Nothing is in the way. {name} can move now.
                </div>
              ) : (
                <ul className="grid gap-2">
                  {current.blockers.map((b, i) => (
                    <BlockerLine
                      key={`${b.code ?? "none"}-${i}`}
                      blocker={b}
                      franchiseeId={
                        hasNoAdmin([b]) ? current.toFranchiseeId : undefined
                      }
                    />
                  ))}
                </ul>
              )}

              {current.warnings.length > 0 ? (
                <ul className="grid gap-2">
                  {current.warnings.map((w) => (
                    <li
                      key={w}
                      className="flex gap-2 rounded-lg border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-warn"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {w}
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="text-[13px] font-medium">
                {coverageSummary(current.coverage)}
              </p>
              <div className="grid gap-2.5">
                <ChipGroup
                  label={`Stays (${current.coverage.keptCount})`}
                  codes={current.coverage.kept}
                />
                <ChipGroup
                  label={`Taken off (${current.coverage.trimmedCount})`}
                  codes={current.coverage.trimmed}
                  hint={`Outside ${current.toFranchiseeName}'s area, so these come off their coverage.`}
                  struck
                />
                <ChipGroup
                  label={`Added (${current.coverage.addedCount})`}
                  codes={current.coverage.added}
                />
              </div>
              {current.coverage.regionChanged && current.coverage.regionAfter ? (
                <p className="text-[13px] text-ink-2">
                  They will work in {current.coverage.regionAfter}.
                </p>
              ) : null}
            </div>
          )}

          {/* The picker. Opens itself on the ordinary case (nothing inside);
              the link below is for the person who wants different pincodes
              than the ones that would stay. */}
          {custom ? (
            <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3">
              <CoverageFields
                regionId={regionId}
                pincodes={picked}
                onRegionId={setRegionId}
                onPincodes={setPicked}
                limitTo={limitTo}
                hasOtherFranchisees
                className="grid gap-4 sm:grid-cols-2"
              />
              {nothingInside ? null : (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={apply.isPending}
                    onClick={() => {
                      setCustom(false);
                      setPicked([]);
                    }}
                  >
                    Use their current pincodes again
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={apply.isPending || !current}
                onClick={() => setCustom(true)}
              >
                Choose different pincodes instead
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {applyError ? (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] text-danger"
        >
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {applyError}
        </div>
      ) : null}

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" disabled={apply.isPending} />}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={!confirmable}>
          {apply.isPending ? <Spinner data-icon="inline-start" /> : null}
          {apply.isPending ? "Moving…" : `Move ${name}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** One refusal, as sent. A target with nobody to run it links to its page. */
function BlockerLine({
  blocker,
  franchiseeId,
}: {
  blocker: TransferBlocker;
  franchiseeId?: string;
}) {
  return (
    <li
      role="alert"
      className="flex gap-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] text-danger"
    >
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {blocker.message}
        {franchiseeId ? (
          <>
            {" "}
            <Link
              to={`/franchisees/${franchiseeId}`}
              className="font-medium underline underline-offset-2"
            >
              Open the franchisee
            </Link>
          </>
        ) : null}
      </span>
    </li>
  );
}

/** A heading and its pincodes as chips; nothing at all when there are none. */
function ChipGroup({
  label,
  codes,
  hint,
  struck = false,
}: {
  label: string;
  codes: string[];
  hint?: string;
  struck?: boolean;
}) {
  if (codes.length === 0) return null;
  const shown = codes.slice(0, CHIP_CAP);
  // Static strings — an interpolated class is never generated (hard rule 6).
  const skin = struck
    ? "border-warn/30 bg-warn-bg text-warn line-through"
    : "border-line bg-surface-3 text-ink";
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-semibold text-ink-2">{label}</p>
      <ul className="flex flex-wrap gap-1.5" aria-label={label}>
        {shown.map((c) => (
          <li
            key={c}
            className={`rounded-md border px-2 py-0.5 font-mono text-[12px] ${skin}`}
          >
            {c}
          </li>
        ))}
        {codes.length > shown.length ? (
          <li className="px-1 py-0.5 text-[12px] text-ink-3">
            and {codes.length - shown.length} more
          </li>
        ) : null}
      </ul>
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
