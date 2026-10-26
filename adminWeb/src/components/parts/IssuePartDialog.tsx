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
import { noteResolver, type NoteValues } from "./partSchemas";

/**
 * "The new part has left the store" — Task 13 §5.7. A log entry, not a stock
 * movement (P5): who, when, and an optional note. The page owns the mutation
 * and closes this on success only.
 */
export function IssuePartDialog({
  open,
  onOpenChange,
  request,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PartRequest;
  onConfirm: (values: NoteValues) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NoteValues>({
    resolver: noteResolver,
    defaultValues: { note: "" },
  });

  useEffect(() => {
    if (open) reset({ note: "" });
  }, [open, reset]);

  const err = errors.note?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Issue {request.partName} to {request.technicianName}?
          </DialogTitle>
          <DialogDescription>
            Records that the new part has left the store.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onConfirm)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field data-invalid={err ? true : undefined}>
            <FieldLabel htmlFor="issue-part-note">Note (optional)</FieldLabel>
            <Input
              id="issue-part-note"
              maxLength={500}
              autoComplete="off"
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? "issue-part-note-error" : undefined}
              disabled={isPending}
              {...register("note")}
            />
            {err ? (
              <FieldDescription
                id="issue-part-note-error"
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
            <Button type="submit" disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Mark issued
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
