import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePincodePreview, useSavePincodes } from "@/hooks/useFranchisees";
import { FRANCHISEE_PINCODE_TAKEN } from "@/lib/errorCodes";
import { Notice } from "@/components/shared/Notice";
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
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/services/client";
import type { Franchisee, PincodeChange } from "@/types/franchisee";
import { CarveOutPreview } from "./CarveOutPreview";
import {
  canApply,
  checkRangeSyntax,
  formatCount,
  normaliseRangeText,
  previewImpact,
} from "./pincodeRanges";

/**
 * Give a franchisee its pincodes, or change them.
 *
 * Dry run first, then commit — the same two beats as `SerialImportDialog`, with
 * the plan keyed on the debounce so retyping whitespace re-uses one request.
 * The commit's OWN reply is the authoritative summary (no preview digest), so
 * the success toast reports what the commit said, not what the preview promised.
 *
 * Two local phases: edit (the textarea and its plan) and confirm (the totals
 * sentence). A plan that moves nobody skips confirm — "Save pincodes" applies
 * straight through, because there is nothing to be told before pressing it.
 */
export function PincodeRangesDialog({
  open,
  onOpenChange,
  franchisee,
  homeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Never the home franchisee — its pincodes are immutable (server 409s). */
  franchisee?: Franchisee;
  homeName: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        {!franchisee ? null : (
          <PincodesForm
            key={franchisee.id}
            franchisee={franchisee}
            homeName={homeName}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Phase = "edit" | "confirm";

function PincodesForm({
  franchisee,
  homeName,
  onDone,
}: {
  franchisee: Franchisee;
  homeName: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(franchisee.pincodeRanges);
  const [phase, setPhase] = useState<Phase>("edit");
  const debounced = useDebouncedValue(text, 500);
  const save = useSavePincodes();

  // Grammar-checked locally FIRST — a token the server would 422 never leaves
  // the browser (§7 criterion 6). An empty box is not one of those: it is a
  // real answer ("hand everything back"), so the preview runs on it.
  const debouncedCheck = checkRangeSyntax(debounced);
  const syntaxOk = debouncedCheck.ok || debouncedCheck.reason === "empty";
  const preview = usePincodePreview(franchisee.id, normaliseRangeText(debounced), {
    enabled: syntaxOk,
  });
  const plan: PincodeChange | undefined = preview.data;
  const impact = plan ? previewImpact(plan) : null;
  const showConfirm = impact?.any ?? false;
  const applyable = canApply(plan) && syntaxOk && !preview.isFetching;

  const syntaxError = !debouncedCheck.ok && debouncedCheck.reason !== "empty"
    ? syntaxMessage(debouncedCheck)
    : null;

  function commit() {
    if (!applyable) return;
    save.mutate(
      { id: franchisee.id, pincodeRanges: debounced },
      {
        onSuccess: (result) => {
          // The commit's counts — never the preview's.
          const { moved, trimmed, tickets } = previewImpact(result);
          toast.add({
            title: `Pincodes saved for ${franchisee.name}`,
            description: [
              formatCount(result.resolvedCount, "pincode", "pincodes"),
              `${moved} moved`,
              `${trimmed} trimmed`,
              `${tickets} tickets re-stamped`,
            ].join(" · "),
          });
          onDone();
        },
        onError: (error) => {
          // A racing add elsewhere took a pincode in these ranges. The toast is
          // already shown by App.tsx; the dialog returns to the edit phase and
          // the refetched preview names the code and who now owns it.
          if (
            error instanceof ApiError &&
            error.code === FRANCHISEE_PINCODE_TAKEN
          ) {
            setPhase("edit");
            void preview.refetch();
          }
        },
      }
    );
  }

  // The edit-phase button does one of two jobs, named for the job it will do.
  const primary =
    phase === "confirm"
      ? { label: "Apply pincodes", onClick: commit }
      : showConfirm
        ? { label: "Review changes", onClick: () => setPhase("confirm") }
        : { label: "Save pincodes", onClick: commit };
  const primaryDisabled =
    save.isPending || (phase === "edit" ? !applyable || Boolean(syntaxError) : false);

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Pincodes for {franchisee.name}</DialogTitle>
        <DialogDescription>
          Type ranges and single pincodes, separated by commas or new lines —
          for example 500001-500099, 500120. Only pincodes in the master are
          kept.
        </DialogDescription>
      </DialogHeader>

      {phase === "confirm" && plan ? (
        <div className="grid gap-2">
          <p className="text-base font-semibold text-ink">
            Apply these pincodes?
          </p>
          <p className="text-[13px] text-ink-2">
            {formatCount(impact!.moved, "technician", "technicians")} move,{" "}
            {formatCount(impact!.trimmed, "technician", "technicians")} lose
            pincodes and{" "}
            {formatCount(impact!.tickets, "ticket", "tickets")} are re-stamped.
            The technicians' new admins are notified.
          </p>
        </div>
      ) : (
        <Field data-invalid={syntaxError ? true : undefined}>
          <FieldLabel htmlFor="franchisee-pincodes" required>
            Pincode ranges
          </FieldLabel>
          <Textarea
            id="franchisee-pincodes"
            rows={5}
            className="font-mono text-[13px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={syntaxError ? true : undefined}
            aria-describedby={
              syntaxError
                ? "franchisee-pincodes-error"
                : "franchisee-pincodes-preview"
            }
            spellCheck={false}
          />
          {syntaxError ? (
            <FieldDescription
              id="franchisee-pincodes-error"
              role="alert"
              className="text-danger"
            >
              {syntaxError}
            </FieldDescription>
          ) : null}
          {/* The plan lives under the field it predicts, so a reader never
              scrolls away from what their edit produced. */}
          <FieldDescription
            id="franchisee-pincodes-preview"
            className="mt-1"
          >
            {previewContent()}
          </FieldDescription>
        </Field>
      )}

      {/* The plan lives beside the field it predicts, in BOTH phases (§5.4):
          the summary answers "what will this cover?" while typing, and the
          clash list is shown here because a clash blocks Apply before a
          reader ever presses Review changes. In confirm it repeats under the
          totals sentence. */}
      {plan ? <CarveOutPreview change={plan} homeName={homeName} /> : null}

      {/* A failed request is reported by the toaster (App.tsx), not here. */}
      <DialogFooter>
        {phase === "confirm" ? (
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setPhase("edit")}
          >
            Back
          </Button>
        ) : (
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
        )}
        <Button
          type="button"
          onClick={primary.onClick}
          disabled={primaryDisabled}
        >
          {save.isPending && <Spinner data-icon="inline-start" />}
          {primary.label}
        </Button>
      </DialogFooter>
    </div>
  );

  function previewContent() {
    if (!syntaxOk) return null;
    if (preview.isFetching && !plan) {
      return (
        <span className="flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner className="size-3.5" />
          Checking…
        </span>
      );
    }
    if (preview.isError) {
      return (
        <Notice tone="warn" icon={AlertTriangle} title="Couldn't check those pincodes">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void preview.refetch()}
          >
            Try again
          </Button>
        </Notice>
      );
    }
    if (!debounced.trim() && !plan && !preview.isFetching) {
      return "Type a pincode or a range to see what it covers.";
    }
    return null;
  }
}

/**
 * Grammar errors in the §5.10 copy, one per reason — the token is named so a
 * reader can find it in a 500-entry list without hunting.
 */
function syntaxMessage(check: ReturnType<typeof checkRangeSyntax>): string {
  if (check.ok) return "";
  switch (check.reason) {
    case "bad-token":
      return `"${check.token}" is not a pincode or a range. Use six digits, or two joined by a dash.`;
    case "backwards":
      return `"${check.token}" runs backwards — put the smaller pincode first.`;
    case "too-many":
      return "Too many entries — at most 500. Use wider ranges.";
    case "empty":
      return "";
  }
}