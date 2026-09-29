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

/**
 * Why a vendor's payment or credit request was refused.
 *
 * Its own schema rather than `approvals/approvalSchema`'s, and the difference is
 * not stylistic: `vendor_payments.reject_reason` and
 * `vendor_credit_requests.reject_reason` are `String(160)`, following
 * `credit_recharges.reject_reason`, where the approvals one is written against a
 * 255-character column. A shared schema would let a reason through that the
 * server then refuses, which is the worst kind of client validation.
 *
 * Required, and with a floor: the vendor reads this and it is the only thing
 * telling them what to do next. "no" is a refusal they cannot act on.
 */
const schema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Say why, so they know what to do next")
    .max(160, "Keep the reason under 160 characters"),
});

type Values = z.infer<typeof schema>;

export function RejectVendorCreditDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  confirmLabel,
  isPending,
  onReject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the vendor will be able to do about it. */
  description: string;
  placeholder: string;
  confirmLabel: string;
  isPending: boolean;
  onReject: (reason: string, onSuccess: () => void) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RejectForm
            title={title}
            description={description}
            placeholder={placeholder}
            confirmLabel={confirmLabel}
            isPending={isPending}
            onReject={onReject}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  title,
  description,
  placeholder,
  confirmLabel,
  isPending,
  onReject,
  onDone,
}: {
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  isPending: boolean;
  onReject: (reason: string, onSuccess: () => void) => void;
  onDone: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });

  // Closed from `onSuccess` only, never on click — a 409 (somebody else just
  // decided it) has to leave the dialog standing over the toast.
  const submit = (values: Values) => onReject(values.reason, onDone);

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.reason ? true : undefined}>
        <FieldLabel htmlFor="vendor-reject-reason" required>
          Reason
        </FieldLabel>
        <Textarea
          id="vendor-reject-reason"
          rows={3}
          autoFocus
          placeholder={placeholder}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={
            errors.reason ? "vendor-reject-reason-error" : undefined
          }
          {...register("reason")}
        />
        {errors.reason ? (
          <FieldDescription
            id="vendor-reject-reason-error"
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
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" variant="destructive" disabled={isPending}>
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
