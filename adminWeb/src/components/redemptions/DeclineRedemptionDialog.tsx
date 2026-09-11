import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useDeclineRedemption } from "@/hooks/useRedemptions";
import type { RedemptionDetail } from "@/types/redemption";
import { moneyPaise } from "@/utils/money";

/** 160 because the server's column is — the technician reads it in full. */
const declineSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why, so they can fix it")
    .max(160, "Keep the reason under 160 characters"),
});

type DeclineFormValues = z.infer<typeof declineSchema>;

/**
 * Refuse a redemption before paying it — most often because the UPI ID or the
 * name the payer's app shows is wrong. The technician gets the reason on their
 * phone and the amount goes back to their balance, so they can fix the address
 * and ask again.
 *
 * Only before a claim: the server 409s it afterwards, because money may have
 * moved by then. The page stops offering it at that point for the same reason.
 *
 * A form rather than `ConfirmDialog`, for the reason `RejectProductDialog`
 * gives: a required free-text field needs real validation.
 */
export function DeclineRedemptionDialog({
  open,
  onOpenChange,
  redemption,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  redemption: RedemptionDetail;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <DeclineForm redemption={redemption} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeclineForm({
  redemption,
  onDone,
}: {
  redemption: RedemptionDetail;
  onDone: () => void;
}) {
  const decline = useDeclineRedemption();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DeclineFormValues>({
    resolver: zodResolver(declineSchema),
    defaultValues: { reason: "" },
  });

  function submit(values: DeclineFormValues) {
    decline.mutate(
      { id: redemption.id, reason: values.reason },
      {
        // Closed from `onSuccess`, never on click — a 409 (somebody marked it
        // paid meanwhile) leaves the dialog standing over the toast.
        onSuccess: () => {
          toast.add({ title: `${redemption.code} declined` });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          Decline {moneyPaise(redemption.amountPaise)} to {redemption.technicianName}?
        </DialogTitle>
        <DialogDescription>
          {redemption.technicianName} reads your reason, and the amount goes
          back to their balance.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.reason ? true : undefined}>
        <FieldLabel htmlFor="decline-reason" required>
          Reason
        </FieldLabel>
        <Textarea
          id="decline-reason"
          rows={3}
          autoFocus
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "decline-reason-error" : undefined}
          {...register("reason")}
        />
        {errors.reason ? (
          <FieldDescription id="decline-reason-error" role="alert" className="text-danger">
            {errors.reason.message}
          </FieldDescription>
        ) : null}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={decline.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" variant="destructive" disabled={decline.isPending}>
          {decline.isPending ? <Spinner /> : null}
          Decline
        </Button>
      </DialogFooter>
    </form>
  );
}
