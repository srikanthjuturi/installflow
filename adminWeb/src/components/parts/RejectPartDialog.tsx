import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import type { PartRequest } from "@/types/parts";
import { rejectResolver, type RejectValues } from "./partSchemas";

/**
 * Reject a request — or cancel one already approved (owner ruling 2026-10-15,
 * R2). The same call and the same required reason; only the words differ,
 * because the technician was told an approved part was coming.
 *
 * `RescheduleDialog`'s required-reason shape: the technician reads the reason
 * and the territory staff's bell quotes it, so nothing is sent without one.
 * Danger on both, because neither can be undone.
 */
export function RejectPartDialog({
  open,
  onOpenChange,
  request,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PartRequest;
  onConfirm: (values: RejectValues) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RejectValues>({
    resolver: rejectResolver,
    defaultValues: { reason: "" },
  });

  // A dialog that keeps the last request's reason would send it for the next.
  useEffect(() => {
    if (open) reset({ reason: "" });
  }, [open, reset]);

  const cancelling = request.status === "approved";
  const err = errors.reason?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {cancelling
              ? `Cancel the approved ${request.partName}?`
              : `Reject ${request.partName}?`}
          </DialogTitle>
          <DialogDescription>
            {cancelling
              ? `${request.technicianName} was told it was coming — they see your reason.`
              : `${request.technicianName} sees your reason.`}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onConfirm)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field data-invalid={err ? true : undefined}>
            <FieldLabel htmlFor="reject-part-reason" required>
              Reason
            </FieldLabel>
            <Input
              id="reject-part-reason"
              placeholder="Tell the technician why"
              maxLength={255}
              autoComplete="off"
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? "reject-part-reason-error" : undefined}
              disabled={isPending}
              {...register("reason")}
            />
            {err ? (
              <FieldDescription
                id="reject-part-reason-error"
                role="alert"
                className="text-danger"
              >
                {err}
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
              {cancelling ? "Cancel approval" : "Reject request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
