import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldGrid } from "@/components/shared/FieldGrid";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useApproveProduct } from "@/hooks/useApprovals";
import { paiseToRupeeInput as toRupeeInput } from "@/utils/money";
import type { ProductSubmission } from "@/types/approval";
import { SubmissionSummary } from "./SubmissionSummary";
import { approveSchema, type ApproveFormValues } from "./approvalSchema";

/**
 * Price a vendor's submission and let tickets be raised against it.
 *
 * Its own dialog rather than `ConfirmDialog`, for three reasons none of which
 * is the free-text slot (that primitive does have one). It has no
 * `confirmDisabled`, so its only lever is `isPending`, which renders a spinner —
 * a lie about what the app is doing while it waits for somebody to type. It
 * renders no `<form>`, and two validated amounts need `zodResolver`,
 * `aria-invalid`, `role="alert"` and Enter-to-submit. And its confirm button is
 * unconditionally destructive, which approving is not. `ReissueVendorPassword`
 * and the force-close page set the same precedent.
 *
 * It does NOT close itself on submit — the mutation's `onSuccess` does, so a
 * failure leaves the dialog standing over the toast with both figures still
 * typed.
 */
export function ApproveProductDialog({
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
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        {submission ? (
          <ApproveForm
            submission={submission}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({
  submission,
  onDone,
}: {
  submission: ProductSubmission;
  onDone: () => void;
}) {
  const approve = useApproveProduct();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ApproveFormValues>({
    resolver: zodResolver(approveSchema),
    defaultValues: {
      /*
       * Blank on a first submission — a price nobody chose is a price nobody
       * checked, which is the same reason the product form starts empty.
       *
       * NOT blank when a vendor's edit sent an already-approved product back:
       * the last agreed figures are carried through, so the reviewer confirms a
       * number rather than re-deriving one they had already decided.
       */
      technicianPayoutPaise: toRupeeInput(submission.technicianPayoutPaise),
      vendorPricePaise: toRupeeInput(submission.vendorPricePaise),
    },
  });

  function submit(values: ApproveFormValues) {
    approve.mutate(
      {
        id: submission.id,
        // Rupees in the box, paise on the wire — hard rule 9.
        technicianPayoutPaise: Number(values.technicianPayoutPaise) * 100,
        vendorPricePaise: Number(values.vendorPricePaise) * 100,
      },
      {
        onSuccess: () => {
          toast.add({
            title: `${submission.name} approved`,
            description: `${submission.vendorName} can raise tickets against it now.`,
          });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Approve {submission.name}?</DialogTitle>
        <DialogDescription>
          In {submission.nodePath.join(" › ")}, from {submission.vendorName}. Set
          both prices — the product cannot be ticketed until you do.
        </DialogDescription>
      </DialogHeader>

      <SubmissionSummary submission={submission} />

      <FieldGroup className="gap-5">
        {/* Side by side because they are the two halves of one decision — what
            this job is worth — and the margin between them is only legible
            when both are on screen at once. The labels and hints are lifted
            verbatim from the product form: it is the same decision, arriving a
            step later, and re-wording it would make them look like two.

            `FieldGrid`, never `<FieldGroup className="grid">` — the Chrome
            container-query bug that collapses every control to height 0. */}
        <FieldGrid className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.technicianPayoutPaise ? true : undefined}>
            <FieldLabel htmlFor="approve-payout" required>
              Paid to technician (₹)
            </FieldLabel>
            <Input
              id="approve-payout"
              inputMode="numeric"
              placeholder="e.g. 450"
              autoFocus
              aria-invalid={errors.technicianPayoutPaise ? true : undefined}
              aria-describedby={
                errors.technicianPayoutPaise
                  ? "approve-payout-error"
                  : "approve-payout-hint"
              }
              {...register("technicianPayoutPaise")}
            />
            {errors.technicianPayoutPaise ? (
              <FieldDescription
                id="approve-payout-error"
                role="alert"
                className="text-danger"
              >
                {errors.technicianPayoutPaise.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="approve-payout-hint">
                Required. What a technician earns for one job on this model.
              </FieldDescription>
            )}
          </Field>

          <Field data-invalid={errors.vendorPricePaise ? true : undefined}>
            <FieldLabel htmlFor="approve-price" required>
              Charged to vendor (₹)
            </FieldLabel>
            <Input
              id="approve-price"
              inputMode="numeric"
              placeholder="e.g. 1200"
              aria-invalid={errors.vendorPricePaise ? true : undefined}
              aria-describedby={
                errors.vendorPricePaise
                  ? "approve-price-error"
                  : "approve-price-hint"
              }
              {...register("vendorPricePaise")}
            />
            {errors.vendorPricePaise ? (
              <FieldDescription
                id="approve-price-error"
                role="alert"
                className="text-danger"
              >
                {errors.vendorPricePaise.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="approve-price-hint">
                Required. What the vendor pays to raise one of these tickets.
              </FieldDescription>
            )}
          </Field>
        </FieldGrid>
      </FieldGroup>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={approve.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={approve.isPending}>
          {approve.isPending ? <Spinner /> : null}
          Approve product
        </Button>
      </DialogFooter>
    </form>
  );
}
