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
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { useStartMyPayment } from "@/hooks/useVendorCredits";
import { moneyPaise } from "@/utils/money";

function schema(maxPaise: number) {
  return z.object({
    /**
     * Rupees as typed, and paise ARE allowed — two decimals, not a whole number.
     *
     * A debt is whatever the tickets came to, and `vendor_price_paise` is only
     * constrained to be positive, so a vendor can owe ₹3,200.50. A whole-rupee
     * box could not offer that last 50 paise, and the server would then go on
     * reporting it as owed while refusing every request to clear it.
     */
    amount: z
      .number({ error: "Enter an amount" })
      .min(0.01, "At least ₹0.01")
      // Two decimals at most. Compared with a tolerance rather than `% 1 === 0`
      // because `3200.5 * 100` is 320050.00000000006 in binary floating point,
      // and an exact test would refuse a figure the user typed correctly.
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
        "Use at most two decimal places — paise, not fractions of a paisa"
      )
      .refine(
        (v) => Math.round(v * 100) <= maxPaise,
        `At most ${moneyPaise(maxPaise)} — that is what you owe`
      ),
  });
}

type Values = z.infer<ReturnType<typeof schema>>;

/**
 * How much of what is owed to pay now.
 *
 * Part payment is allowed, and the ceiling is the DEBT rather than the limit: a
 * vendor cannot pay ahead, because there would be nothing for the company to
 * apply it to. The server caps it again at UPI's per-transaction limit and
 * against the live figure, so this only saves a refused round trip.
 *
 * Creating the payment goes straight to its page, where the QR is.
 */
export function PayDialog({
  open,
  onOpenChange,
  max,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PAISE — what is owed, already capped by the server. */
  max: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open ? (
          <PayForm max={max} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ max, onDone }: { max: number; onDone: () => void }) {
  const navigate = useNavigate();
  const origin = useNavOrigin("Back to credit");
  const start = useStartMyPayment();
  // The exact amount owed, to the paise. `max` is already the server's own
  // ceiling (what is owed, capped at UPI's per-transaction limit), so there is
  // nothing to round down to and rounding down is what made a sub-rupee residue
  // unpayable.
  const maxRupees = max / 100;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema(max)),
    defaultValues: { amount: maxRupees },
  });

  function submit(values: Values) {
    // Round, not truncate: `3200.5 * 100` is 320050.00000000006 in binary
    // floating point, and `Math.trunc` of that is 320050 by luck rather than by
    // rule. The server compares this against the live figure regardless.
    start.mutate(Math.round(values.amount * 100), {
      // Closed from `onSuccess` only — a 409 (one already open) leaves the
      // dialog standing over the toast.
      onSuccess: (payment) => {
        onDone();
        navigate(`/portal/credit/payments/${payment.id}`, { state: origin });
      },
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Pay what you owe</DialogTitle>
        <DialogDescription>
          You owe {moneyPaise(max)}. Pay all of it or part of it — you&apos;ll get
          a UPI QR on the next screen.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.amount ? true : undefined}>
        <FieldLabel htmlFor="pay-amount" required>
          Amount (₹)
        </FieldLabel>
        <Input
          id="pay-amount"
          type="number"
          inputMode="decimal"
          min={0.01}
          max={maxRupees}
          step="0.01"
          autoFocus
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? "pay-amount-error" : "pay-amount-hint"}
          {...register("amount", { valueAsNumber: true })}
        />
        {errors.amount ? (
          <FieldDescription
            id="pay-amount-error"
            role="alert"
            className="text-danger"
          >
            {errors.amount.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="pay-amount-hint">
            Up to {moneyPaise(max)}
          </FieldDescription>
        )}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={start.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={start.isPending}>
          {start.isPending ? <Spinner data-icon="inline-start" /> : null}
          Get the QR
        </Button>
      </DialogFooter>
    </form>
  );
}
