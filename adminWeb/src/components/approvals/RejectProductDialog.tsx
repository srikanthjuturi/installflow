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
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useRejectProduct } from "@/hooks/useApprovals";
import type { ProductSubmission } from "@/types/approval";
import { rejectSchema, type RejectFormValues } from "./approvalSchema";

/**
 * Refuse a submission, with a reason the vendor reads.
 *
 * A form rather than `ConfirmDialog`, for the reasons its sibling
 * `ApproveProductDialog` sets out — chiefly that a required free-text field
 * needs real validation, and `ConfirmDialog` has no way to keep its confirm
 * button disabled while somebody is still typing.
 *
 * Nothing is deleted and no price is written: the vendor edits the product and
 * submits it again, which clears this reason on the way past.
 */
export function RejectProductDialog({
  open,
  onOpenChange,
  submission,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission?: ProductSubmission;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {submission ? (
          <RejectForm
            submission={submission}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  submission,
  onDone,
}: {
  submission: ProductSubmission;
  onDone: () => void;
}) {
  const reject = useRejectProduct();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectFormValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });

  function submit(values: RejectFormValues) {
    reject.mutate(
      { id: submission.id, reason: values.reason },
      {
        onSuccess: () => {
          toast.add({ title: `${submission.name} rejected` });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Reject {submission.name}?</DialogTitle>
        <DialogDescription>
          {submission.vendorName} will see your reason and can edit and
          resubmit. Nothing is deleted.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.reason ? true : undefined}>
        <FieldLabel htmlFor="reject-reason" required>
          Reason
        </FieldLabel>
        <Textarea
          id="reject-reason"
          rows={3}
          autoFocus
          placeholder="e.g. The capacity does not match the model number — check the invoice."
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={
            errors.reason ? "reject-reason-error" : "reject-reason-hint"
          }
          {...register("reason")}
        />
        {errors.reason ? (
          <FieldDescription
            id="reject-reason-error"
            role="alert"
            className="text-danger"
          >
            {errors.reason.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="reject-reason-hint">
            The vendor reads this, so say what to change.
          </FieldDescription>
        )}
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
          Reject product
        </Button>
      </DialogFooter>
    </form>
  );
}
