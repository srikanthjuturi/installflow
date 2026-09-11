import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import { moneyPaise } from "@/utils/money";
import type { TicketPenalty } from "@/types/ticket";
import {
  reversePenaltyResolver,
  type ReversePenaltyFormValues,
} from "./ticketSchema";

/**
 * Giving one penalty back — all of it, with a reason.
 *
 * `RescheduleDialog`'s shape: a required reason, because nothing else stands
 * behind the act but the manager pressing the button, and it returns pool
 * money. The amount is on the button for `NoShowDialog`'s reason — it cannot
 * be pressed without having been read.
 *
 * Full amount only, and deliberately so: one reversal per penalty, recorded as
 * its own ledger row, keeps the technician's month, the pool and their
 * Earnings screen each exactly as if the charge never happened. There is no
 * undo here — a reversal is money history like the charge it cancels.
 *
 * Net-new copy, NOT from either prototype — **approved as written on
 * 2026-09-11.** A new string here needs the same sign-off.
 */
export function ReversePenaltyDialog({
  open,
  onOpenChange,
  penalty,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The one being reversed. The dialog stays mounted, so null when closed. */
  penalty: TicketPenalty | null;
  onConfirm: (values: ReversePenaltyFormValues) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ReversePenaltyFormValues>({
    resolver: reversePenaltyResolver,
    defaultValues: { reason: "" },
  });

  // A dialog that keeps the last penalty's reason would file it against the
  // next one.
  useEffect(() => {
    if (open) reset({ reason: "" });
  }, [open, reset]);

  const err = errors.reason?.message;
  const amount = penalty ? moneyPaise(penalty.amountPaise) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reverse this penalty?</DialogTitle>
          <DialogDescription>
            {penalty
              ? `${penalty.technicianName} gets the full ${amount} back. It comes off their penalties for the month and out of the penalty pool, and they are told on their phone.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onConfirm)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field data-invalid={err ? true : undefined}>
            <FieldLabel htmlFor="reverse-penalty-reason">
              Why is it being reversed?
            </FieldLabel>
            <Input
              id="reverse-penalty-reason"
              placeholder="Customer asked to cancel, confirmed by phone"
              maxLength={160}
              aria-invalid={err ? true : undefined}
              aria-describedby="reverse-penalty-reason-hint"
              disabled={isPending}
              {...register("reason")}
            />
            <FieldDescription
              id="reverse-penalty-reason-hint"
              role={err ? "alert" : undefined}
              className={err ? "text-danger" : undefined}
            >
              {err ?? "Required. It is kept with the money and on the ticket's trail."}
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
            <Button type="submit" disabled={isPending || !penalty}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Reverse {amount} penalty
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
