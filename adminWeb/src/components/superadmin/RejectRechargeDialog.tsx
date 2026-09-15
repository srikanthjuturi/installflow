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
import { useRejectRecharge } from "@/hooks/usePlatform";
import type { PlatformRechargeDetail } from "@/types/platform";
import { moneyPaise } from "@/utils/money";

/** 160 because the server's column is — the company reads it in full. */
const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why, so they can fix it")
    .max(160, "Keep the reason under 160 characters"),
});

type RejectValues = z.infer<typeof rejectSchema>;

/**
 * Refuse a recharge the company says it paid — the payment is not in the
 * account, or does not match. Final: the company reads the reason and starts a
 * new recharge. A form rather than `ConfirmDialog`, for the reason
 * `DeclineRedemptionDialog` gives: a required reason needs real validation.
 */
export function RejectRechargeDialog({
  open,
  onOpenChange,
  recharge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recharge: PlatformRechargeDetail;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RejectForm recharge={recharge} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  recharge,
  onDone,
}: {
  recharge: PlatformRechargeDetail;
  onDone: () => void;
}) {
  const reject = useRejectRecharge();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });

  function submit(values: RejectValues) {
    reject.mutate(
      { id: recharge.id, reason: values.reason },
      {
        // Closed from `onSuccess` only, so a 409 leaves it standing.
        onSuccess: () => {
          toast.add({ title: `${recharge.code} rejected` });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          Reject {moneyPaise(recharge.amountPaise)} from {recharge.companyName}?
        </DialogTitle>
        <DialogDescription>
          {recharge.companyName} reads your reason. No credits are added.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.reason ? true : undefined}>
        <FieldLabel htmlFor="reject-recharge-reason" required>
          Reason
        </FieldLabel>
        <Textarea
          id="reject-recharge-reason"
          rows={3}
          autoFocus
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "reject-recharge-reason-error" : undefined}
          {...register("reason")}
        />
        {errors.reason ? (
          <FieldDescription
            id="reject-recharge-reason-error"
            role="alert"
            className="text-danger"
          >
            {errors.reason.message}
          </FieldDescription>
        ) : null}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={reject.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" variant="destructive" disabled={reject.isPending}>
          {reject.isPending ? <Spinner /> : null}
          Reject
        </Button>
      </DialogFooter>
    </form>
  );
}
