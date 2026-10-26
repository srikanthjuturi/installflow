import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useFranchiseeOptions } from "@/hooks/useFranchisees";
import { CoverageFields } from "./CoverageFields";
import { TechnicianTypeField } from "./TechnicianTypeField";
import { EMPTY_INVITE, inviteSchema, type InviteFormValues } from "./onboarding";

interface TechnicianInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: InviteFormValues) => void;
  isSubmitting: boolean;
}

/**
 * Invite onboarding: a phone number, and nothing else required.
 *
 * Everything else about the technician — name, photo, categories, coverage —
 * is theirs to fill in from the app, which is the whole point of this path.
 */
export function TechnicianInviteDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: TechnicianInviteDialogProps) {

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: EMPTY_INVITE,
  });

  // The CoverageFields hint names the franchisee carve-out only when there is
  // another franchisee to carve against — the same test the edit form makes.
  const { has } = useFeatureAccess();
  const { data: franchiseeOptions } = useFranchiseeOptions({
    enabled: has("franchisees.view"),
  });
  const hasOtherFranchisees = (franchiseeOptions?.length ?? 0) > 1;

  // The dialog stays mounted, so a reopened form would otherwise still hold
  // the last attempt.
  useEffect(() => {
    if (open) reset(EMPTY_INVITE);
  }, [open, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Invite technician</DialogTitle>
            <DialogDescription>
              A WhatsApp invite goes to this number with a link to the technician
              app. They fill in their own name, photo and categories — you set
              where they work.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field data-invalid={errors.phone ? true : undefined}>
              <FieldLabel htmlFor="invite-phone" required>
                Mobile number
              </FieldLabel>
              <Input
                id="invite-phone"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="+91 98765 43210"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={
                  errors.phone ? "invite-phone-error" : "invite-phone-hint"
                }
                {...register("phone")}
              />
              {errors.phone ? (
                <FieldDescription
                  id="invite-phone-error"
                  role="alert"
                  className="text-danger"
                >
                  {errors.phone.message}
                </FieldDescription>
              ) : (
                <FieldDescription id="invite-phone-hint">
                  Must be on WhatsApp. Include the country code.
                </FieldDescription>
              )}
            </Field>

            {/* Task 08 — how they are paid. Known at intake for the same
                reason the Add form asks it: who answers for the money is a
                fact the manager has when they decide to invite, not one the
                technician volunteers later. */}
            <Controller
              name="technicianType"
              control={control}
              render={({ field }) => (
                <TechnicianTypeField
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.technicianType?.message}
                  errorId="invite-type-error"
                />
              )}
            />

            {/* Coverage is assigned here, not by the technician: the manager
                knows the area and the workload, and somebody joining on a phone
                could otherwise claim a district nobody meant to give them. The
                app shows this list and does not offer to change it. */}
            <Controller
              name="regionId"
              control={control}
              render={({ field: region }) => (
                <Controller
                  name="pincodes"
                  control={control}
                  render={({ field: pins }) => (
                    <CoverageFields
                      regionId={region.value}
                      pincodes={pins.value}
                      onRegionId={region.onChange}
                      onPincodes={pins.onChange}
                      regionError={errors.regionId?.message}
                      pincodeError={errors.pincodes?.message}
                      hasOtherFranchisees={hasOtherFranchisees}
                      className="grid gap-4"
                    />
                  )}
                />
              )}
            />
          </FieldGroup>

          {/* The failure is reported in the toaster (App.tsx), not here. */}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
