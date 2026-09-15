import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCreateRecharge } from "@/hooks/useCredits";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { money } from "@/utils/money";

function amountSchema(min: number, max: number) {
  const range = `Between ${money(min)} and ${money(max)}`;
  return z.object({
    amount: z
      .number({ error: "Enter an amount" })
      .int("Whole rupees only")
      .min(min, range)
      .max(max, range),
  });
}

type AmountValues = z.infer<ReturnType<typeof amountSchema>>;

/**
 * How much to recharge. One credit for every rupee.
 *
 * The bounds are the server's — the platform's minimum and UPI's own limit —
 * sent with the balance, so this only saves a refused round trip. Creating the
 * recharge goes straight to its page, where the QR is.
 */
export function RechargeDialog({
  open,
  onOpenChange,
  min,
  max,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  min: number;
  max: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open ? (
          <AmountForm min={min} max={max} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AmountForm({
  min,
  max,
  onDone,
}: {
  min: number;
  max: number;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const origin = useNavOrigin("Back to credits");
  const create = useCreateRecharge();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AmountValues>({
    resolver: zodResolver(amountSchema(min, max)),
  });

  function submit(values: AmountValues) {
    create.mutate(values.amount, {
      // Closed from `onSuccess` only — a 409 (one already open) leaves the
      // dialog standing over the toast.
      onSuccess: (recharge) => {
        onDone();
        navigate(`/credits/recharges/${recharge.id}`, { state: origin });
      },
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Recharge credits</DialogTitle>
        <DialogDescription>
          One credit for every rupee. You&apos;ll pay by UPI on the next screen.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.amount ? true : undefined}>
        <FieldLabel htmlFor="recharge-amount" required>
          Amount (₹)
        </FieldLabel>
        <Input
          id="recharge-amount"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          autoFocus
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? "recharge-amount-error" : "recharge-amount-hint"}
          {...register("amount", { valueAsNumber: true })}
        />
        {errors.amount ? (
          <FieldDescription id="recharge-amount-error" role="alert" className="text-danger">
            {errors.amount.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="recharge-amount-hint">
            Between {money(min)} and {money(max)}
          </FieldDescription>
        )}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={create.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Continue to pay
        </Button>
      </DialogFooter>
    </form>
  );
}
