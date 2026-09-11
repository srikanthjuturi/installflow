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
import { useRejectBrand, useRejectProduct } from "@/hooks/useApprovals";
import type { BrandSubmission, ProductSubmission } from "@/types/approval";
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
  const reject = useRejectProduct();
  return (
    <RejectReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      subject={
        submission
          ? {
              id: submission.id,
              name: submission.name,
              vendorName: submission.vendorName,
            }
          : undefined
      }
      description="will see your reason and can edit and resubmit. Nothing is deleted."
      placeholder="e.g. The capacity does not match the model number — check the invoice."
      confirmLabel="Reject product"
      isPending={reject.isPending}
      onReject={(input, onSuccess) => reject.mutate(input, { onSuccess })}
    />
  );
}

/**
 * The same refusal for a brand a vendor added. The vendor may rename it and
 * send it again, which is what the reason is for.
 */
export function RejectBrandDialog({
  open,
  onOpenChange,
  submission,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission?: BrandSubmission;
}) {
  const reject = useRejectBrand();
  return (
    <RejectReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      subject={submission}
      description="will see your reason and can correct the name and resubmit. Nothing is deleted."
      placeholder="e.g. We only list brands you hold a distribution agreement for — send it with the agreement."
      confirmLabel="Reject brand"
      isPending={reject.isPending}
      onReject={(input, onSuccess) => reject.mutate(input, { onSuccess })}
    />
  );
}

interface RejectSubject {
  id: string;
  name: string;
  vendorName: string;
}

function RejectReasonDialog({
  open,
  onOpenChange,
  subject,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: RejectSubject;
} & Omit<RejectFormProps, "subject" | "onDone">) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {subject ? (
          <RejectForm
            subject={subject}
            onDone={() => onOpenChange(false)}
            {...form}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface RejectFormProps {
  subject: RejectSubject;
  /** Follows the vendor's name: "Crestline will see your reason and…". */
  description: string;
  placeholder: string;
  confirmLabel: string;
  isPending: boolean;
  onReject: (
    input: { id: string; reason: string },
    onSuccess: () => void
  ) => void;
  onDone: () => void;
}

function RejectForm({
  subject,
  description,
  placeholder,
  confirmLabel,
  isPending,
  onReject,
  onDone,
}: RejectFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectFormValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });

  function submit(values: RejectFormValues) {
    onReject({ id: subject.id, reason: values.reason }, () => {
      toast.add({ title: `${subject.name} rejected` });
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Reject {subject.name}?</DialogTitle>
        <DialogDescription>
          {subject.vendorName} {description}
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
          placeholder={placeholder}
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
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" variant="destructive" disabled={isPending}>
          {isPending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
