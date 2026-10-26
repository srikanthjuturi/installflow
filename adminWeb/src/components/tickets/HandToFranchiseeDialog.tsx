import { useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFranchiseeOptions } from "@/hooks/useTickets";
import {
  blockerSentence,
  dialogDefault,
  optionLabel,
  optionWarning,
} from "@/lib/handOver";
import type { TicketStatus } from "@/types/ticket";
import { handOverResolver, type HandOverFormValues } from "./ticketSchema";

/**
 * Hand an unassigned ticket to another franchisee (Task 18, owner ruling R12).
 *
 * ⚠ **PROPOSED copy, not from the prototype** (which has no franchisees) — the
 * strings are doc 18 §5.3 as written and await sign-off (index §7).
 *
 * A **radio list rather than a `Select`**: the counts are the point of the
 * screen — "0 eligible" next to the franchisee that is stuck, "3 eligible · 2
 * online" next to the one that can help — and a closed menu hides them. The
 * current franchisee is shown but disabled. Nothing is preselected: a hand-over
 * is a decision, so **Hand over** stays disabled until a franchisee AND a reason
 * are given (the reason is the only record of why it moved, and both
 * franchisees' admins read it on the ticket).
 *
 * States, in order: loading skeleton rows → the list → (the server says the
 * ticket can no longer move) only the blocker sentence and Close. A 409 on
 * submit makes the hook re-read the options, which lands in that last state.
 * Validation fires on blur and on submit, never on the first keystroke.
 */
export function HandToFranchiseeDialog({
  open,
  onOpenChange,
  ticket,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: { id: string; code: string; status: TicketStatus; franchiseeName: string | null };
  onConfirm: (values: HandOverFormValues) => void;
  isPending: boolean;
}) {
  const { data, isPending: loading } = useFranchiseeOptions(ticket.id, open);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HandOverFormValues>({
    resolver: handOverResolver,
    mode: "onBlur",
    defaultValues: { franchiseeId: "", reason: "" },
  });

  // A dialog that keeps the last ticket's answer is a dialog that hands the
  // wrong ticket to the wrong franchisee on the second use.
  useEffect(() => {
    if (open) {
      const { franchiseeId, reason } = dialogDefault([]);
      reset({ franchiseeId, reason });
    }
  }, [open, reset]);

  const rows = useMemo(() => dialogDefault(data?.options ?? []).rows, [data]);
  const chosenId = useWatch({ control, name: "franchiseeId" });
  const reason = useWatch({ control, name: "reason" });
  const chosen = rows.find((r) => r.id === chosenId) ?? null;
  const warning = chosen
    ? optionWarning(chosen, {
        status: ticket.status,
        slotOffered: data?.slotOffered ?? true,
      })
    : null;
  const blocked = data && !data.canHandOver;
  const current = ticket.franchiseeName ?? "the current franchisee";
  const canSubmit =
    !!chosen && !chosen.disabled && reason.trim().length >= 3 && !isPending;
  const err = (name: keyof HandOverFormValues) => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto scroll-none">
        <DialogHeader>
          <DialogTitle>Hand {ticket.code} to another franchisee</DialogTitle>
          <DialogDescription>
            Use this when {current} can't take the job — nobody certified,
            everyone at their daily limit, or nobody online.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 rounded-md" />
            <Skeleton className="h-14 rounded-md" />
            <Skeleton className="h-14 rounded-md" />
          </div>
        ) : blocked ? (
          <p
            role="alert"
            className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn"
          >
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            <span>{blockerSentence(data.blocker, ticket)}</span>
          </p>
        ) : (
          <form
            onSubmit={handleSubmit(onConfirm)}
            className="flex flex-col gap-4"
            noValidate
          >
            <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
              <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                Handing a ticket over takes it away from {current}. The other
                franchisee's technicians are offered it, and they are paid by
                their own franchisee's rules, including travel.
              </span>
            </p>

            <Field data-invalid={err("franchiseeId") ? true : undefined}>
              <FieldLabel id="hand-over-franchisee-label">Franchisee</FieldLabel>
              <Controller
                control={control}
                name="franchiseeId"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={(v) => field.onChange(String(v))}
                    aria-labelledby="hand-over-franchisee-label"
                    className="max-h-[45vh] gap-1.5 overflow-y-auto scroll-none"
                  >
                    {rows.map((row) => (
                      <label
                        key={row.id}
                        className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2.5 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60 has-[[data-checked]]:border-primary"
                      >
                        <RadioGroupItem
                          value={row.id}
                          disabled={row.disabled}
                          className="mt-0.5"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                            {row.name}
                            {row.isHome ? (
                              <Badge variant="secondary">Home</Badge>
                            ) : null}
                            {row.kind === "external" ? (
                              <Badge variant="outline">External</Badge>
                            ) : null}
                            {row.isCurrent ? (
                              <Badge variant="outline">Current</Badge>
                            ) : null}
                          </span>
                          <span className="text-xs text-ink-2">
                            {optionLabel(row)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                )}
              />
              {err("franchiseeId") ? (
                <FieldDescription role="alert" className="text-danger">
                  {err("franchiseeId")}
                </FieldDescription>
              ) : null}
            </Field>

            {warning ? (
              <p
                role="status"
                className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn"
              >
                <Info className="mt-px size-4 shrink-0" aria-hidden />
                <span>{warning}</span>
              </p>
            ) : null}

            <Field data-invalid={err("reason") ? true : undefined}>
              <FieldLabel htmlFor="hand-over-reason">Reason</FieldLabel>
              <Input
                id="hand-over-reason"
                placeholder="Why is it moving?"
                aria-invalid={err("reason") ? true : undefined}
                aria-describedby="hand-over-reason-hint"
                {...register("reason")}
              />
              <FieldDescription
                id="hand-over-reason-hint"
                role={err("reason") ? "alert" : undefined}
                className={err("reason") ? "text-danger" : undefined}
              >
                {err("reason") ?? "Shown to both franchisees' admins on the ticket."}
              </FieldDescription>
            </Field>

            <DialogFooter>
              <DialogClose
                render={
                  <Button variant="outline" disabled={isPending}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={!canSubmit}>
                {isPending ? <Spinner className="size-4" /> : null}
                Hand over
              </Button>
            </DialogFooter>
          </form>
        )}

        {blocked ? (
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
