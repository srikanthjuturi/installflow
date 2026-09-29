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
import { useApproveLimitRequest } from "@/hooks/useVendorCredits";
import type { VendorCreditRequest } from "@/types/vendorCredit";
import { money, moneyPaise } from "@/utils/money";

/** One crore — `rules.LIMITS["vendor_credit_limit_paise"]`, in whole rupees. */
const MAX_RUPEES = 10_000_000;

function schema(min: number) {
  return z.object({
    granted: z
      .number({ error: "Enter an amount" })
      .int("Whole rupees only")
      .min(min, `At least ${money(min)} — that is the limit they have now`)
      .max(MAX_RUPEES, `At most ${money(MAX_RUPEES)}`),
  });
}

type Values = z.infer<ReturnType<typeof schema>>;

/**
 * Granting a vendor a bigger line — at the figure decided HERE, not the figure
 * they asked for.
 *
 * Prefilled with what they asked, because that is the common answer, but it is an
 * editable number and not a confirmation: the person approving knows things the
 * person asking does not. The floor is the line they already have, so an
 * "approval" cannot quietly cut it — lowering a line is an edit on the Vendors
 * screen, where it reads as what it is.
 */
export function ApproveLimitDialog({
  request,
  onOpenChange,
}: {
  request: VendorCreditRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {request ? (
          <ApproveForm request={request} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({
  request,
  onDone,
}: {
  request: VendorCreditRequest;
  onDone: () => void;
}) {
  const approve = useApproveLimitRequest();
  const min = Math.ceil(request.currentLimitPaise / 100);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema(min)),
    defaultValues: { granted: Math.round(request.requestedLimitPaise / 100) },
  });

  function submit(values: Values) {
    approve.mutate(
      { id: request.id, grantedLimitPaise: values.granted * 100 },
      // Closed from `onSuccess` only — a 409 (somebody else just decided it)
      // leaves the dialog standing over the toast.
      { onSuccess: onDone }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Raise the credit limit</DialogTitle>
        <DialogDescription>
          {request.vendorName ?? "This vendor"} asked for{" "}
          {moneyPaise(request.requestedLimitPaise)}, up from{" "}
          {moneyPaise(request.currentLimitPaise)}. Grant that, or a different
          figure.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.granted ? true : undefined}>
        <FieldLabel htmlFor="granted-limit" required>
          New limit (₹)
        </FieldLabel>
        <Input
          id="granted-limit"
          type="number"
          inputMode="numeric"
          min={min}
          max={MAX_RUPEES}
          step={1}
          autoFocus
          aria-invalid={errors.granted ? true : undefined}
          aria-describedby={
            errors.granted ? "granted-limit-error" : "granted-limit-hint"
          }
          {...register("granted", { valueAsNumber: true })}
        />
        {errors.granted ? (
          <FieldDescription
            id="granted-limit-error"
            role="alert"
            className="text-danger"
          >
            {errors.granted.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="granted-limit-hint">
            What they may owe before their intake stops. It does not bill them.
          </FieldDescription>
        )}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={approve.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={approve.isPending}>
          {approve.isPending ? <Spinner data-icon="inline-start" /> : null}
          Approve
        </Button>
      </DialogFooter>
    </form>
  );
}
