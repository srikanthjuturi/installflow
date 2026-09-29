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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useAskForLimit } from "@/hooks/useVendorCredits";
import { money, moneyPaise } from "@/utils/money";

/** One crore — `rules.LIMITS["vendor_credit_limit_paise"]`, in whole rupees. */
const MAX_RUPEES = 10_000_000;

function schema(currentRupees: number) {
  return z.object({
    amount: z
      .number({ error: "Enter an amount" })
      .int("Whole rupees only")
      .gt(currentRupees, `More than ${money(currentRupees)} — that is your limit now`)
      .max(MAX_RUPEES, `At most ${money(MAX_RUPEES)}`),
    note: z.string().trim().max(500, "Keep it under 500 characters").optional(),
  });
}

type Values = z.infer<ReturnType<typeof schema>>;

/**
 * Asking for a bigger credit line.
 *
 * Nothing is granted here — it goes to the company, and somebody there decides,
 * possibly for a smaller figure. The dialog says so, because a request that looks
 * like a setting is a request somebody expects to take effect.
 *
 * The note is optional: the number is the request, and a reason only helps.
 */
export function AskLimitDialog({
  open,
  onOpenChange,
  currentLimitPaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLimitPaise: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <AskForm
            currentLimitPaise={currentLimitPaise}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AskForm({
  currentLimitPaise,
  onDone,
}: {
  currentLimitPaise: number;
  onDone: () => void;
}) {
  const ask = useAskForLimit();
  const currentRupees = Math.floor(currentLimitPaise / 100);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema(currentRupees)),
  });

  function submit(values: Values) {
    ask.mutate(
      {
        requestedLimitPaise: values.amount * 100,
        ...(values.note ? { note: values.note } : {}),
      },
      // Closed from `onSuccess` only — a 409 (one already waiting) leaves the
      // dialog standing over the toast.
      {
        onSuccess: () => {
          toast.add({ title: "Sent for approval" });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Ask for a higher limit</DialogTitle>
        <DialogDescription>
          Your limit is {moneyPaise(currentLimitPaise)}. Somebody at the company
          decides, and may set a different figure.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.amount ? true : undefined}>
        <FieldLabel htmlFor="ask-amount" required>
          New limit (₹)
        </FieldLabel>
        <Input
          id="ask-amount"
          type="number"
          inputMode="numeric"
          min={currentRupees + 1}
          max={MAX_RUPEES}
          step={1}
          autoFocus
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? "ask-amount-error" : "ask-amount-hint"}
          {...register("amount", { valueAsNumber: true })}
        />
        {errors.amount ? (
          <FieldDescription
            id="ask-amount-error"
            role="alert"
            className="text-danger"
          >
            {errors.amount.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="ask-amount-hint">
            More than {money(currentRupees)}
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={errors.note ? true : undefined}>
        <FieldLabel htmlFor="ask-note">Why (optional)</FieldLabel>
        <Textarea
          id="ask-note"
          rows={3}
          placeholder="e.g. We have a batch of 40 installs going out next week."
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? "ask-note-error" : undefined}
          {...register("note")}
        />
        {errors.note ? (
          <FieldDescription id="ask-note-error" role="alert" className="text-danger">
            {errors.note.message}
          </FieldDescription>
        ) : null}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={ask.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={ask.isPending}>
          {ask.isPending ? <Spinner data-icon="inline-start" /> : null}
          Send request
        </Button>
      </DialogFooter>
    </form>
  );
}
