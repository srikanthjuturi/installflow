import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useSetTechnicianHolding } from "@/hooks/useTechnicianRules";
import { moneyPaise } from "@/utils/money";
import {
  holdingSchema,
  paiseToRupees,
  rupeesToPaise,
  type HoldingFormValues,
} from "./technicianRulesSchema";

/**
 * Set, change or release the amount held back from what a technician may
 * redeem. The money stays theirs on the ledger; only the redeem request is
 * reduced. 0 releases. A reason is always required and is kept in the trail.
 *
 * Closed from the success handler only — a 403/409 must leave the dialog
 * standing under the toast.
 */
export function TechnicianHoldingDialog({
  open,
  onOpenChange,
  technicianId,
  currentPaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicianId: string;
  currentPaise: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <HoldingForm
            technicianId={technicianId}
            currentPaise={currentPaise}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HoldingForm({
  technicianId,
  currentPaise,
  onDone,
}: {
  technicianId: string;
  currentPaise: number;
  onDone: () => void;
}) {
  const save = useSetTechnicianHolding(technicianId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<HoldingFormValues>({
    resolver: zodResolver(holdingSchema),
    defaultValues: { amountRupees: paiseToRupees(currentPaise), reason: "" },
  });

  const submit = async (v: HoldingFormValues) => {
    try {
      const amountPaise = rupeesToPaise(v.amountRupees) ?? 0;
      await save.mutateAsync({ amountPaise, reason: v.reason });
      toast.add({ title: amountPaise === 0 ? "Holding released" : "Holding saved" });
      onDone();
    } catch {
      /* The global handler has toasted it; what was typed stays. */
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Set or change holding</DialogTitle>
        <DialogDescription>
          Held money stays theirs on the ledger, but they cannot redeem it until
          you release it. Now held: {moneyPaise(currentPaise)}.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.amountRupees ? true : undefined}>
        <FieldLabel htmlFor="holding-amount" required>
          Amount to hold (₹)
        </FieldLabel>
        <Input
          id="holding-amount"
          inputMode="decimal"
          autoFocus
          aria-invalid={errors.amountRupees ? true : undefined}
          aria-describedby={
            errors.amountRupees ? "holding-amount-error" : "holding-amount-hint"
          }
          {...register("amountRupees")}
        />
        {errors.amountRupees ? (
          <FieldDescription id="holding-amount-error" role="alert" className="text-danger">
            {errors.amountRupees.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="holding-amount-hint">
            Enter 0 to release everything.
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={errors.reason ? true : undefined}>
        <FieldLabel htmlFor="holding-reason" required>
          Reason
        </FieldLabel>
        <Textarea
          id="holding-reason"
          rows={3}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "holding-reason-error" : undefined}
          {...register("reason")}
        />
        {errors.reason ? (
          <FieldDescription id="holding-reason-error" role="alert" className="text-danger">
            {errors.reason.message}
          </FieldDescription>
        ) : null}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={save.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save holding
        </Button>
      </DialogFooter>
    </form>
  );
}
