import { useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { partnerInviteSchema, type PartnerInviteValues } from "./partnerSchema";
import type { PartnerKind } from "@/types";

const EMPTY: PartnerInviteValues = { phone: "" };

interface PartnerInviteDialogProps {
  kind: PartnerKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PartnerInviteValues) => void;
  isSubmitting: boolean;
}

/**
 * Appointment, in one field. The mobile number is where the invite goes, so it
 * is the only thing collected here — the partner fills in the rest themselves.
 */
export function PartnerInviteDialog({
  kind,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: PartnerInviteDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PartnerInviteValues>({
    resolver: zodResolver(partnerInviteSchema),
    defaultValues: EMPTY,
  });

  // The dialog stays mounted, so a reopened form would otherwise still hold
  // the last attempt.
  useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  const error = errors.phone?.message;
  const label = kind === "Freelancer" ? "freelancer" : "franchise";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create {label}</DialogTitle>
          <DialogDescription>
            An invite goes to this number. The {label} completes the rest of the
            profile from it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="partner-phone">Mobile number</FieldLabel>
            <Input
              id="partner-phone"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              placeholder="+91 "
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? "partner-phone-error" : "partner-phone-hint"
              }
              {...register("phone")}
            />
            {error ? (
              <FieldDescription
                id="partner-phone-error"
                role="alert"
                className="text-danger"
              >
                {error}
              </FieldDescription>
            ) : (
              <FieldDescription id="partner-phone-hint">
                10-digit Indian mobile number.
              </FieldDescription>
            )}
          </Field>

          <DialogFooter className="mt-5">
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Create {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
