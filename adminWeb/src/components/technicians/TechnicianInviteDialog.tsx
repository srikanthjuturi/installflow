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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
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
  const { regions, isLoading: loadingRegions } = useAssignableRegions();

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

  // The dialog stays mounted, so a reopened form would otherwise still hold
  // the last attempt.
  useEffect(() => {
    if (open) reset(EMPTY_INVITE);
  }, [open, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Invite technician</DialogTitle>
            <DialogDescription>
              A WhatsApp invite goes to this number with a link to the technician
              app. They fill in their own name, photo, categories and areas.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field data-invalid={errors.phone ? true : undefined}>
              <FieldLabel htmlFor="invite-phone">Mobile number</FieldLabel>
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

            {/* A manager who holds one region has nothing to choose between,
                and the server fills it in from their own scope anyway. */}
            {regions.length > 1 ? (
              <Field>
                <FieldLabel htmlFor="invite-region">Region</FieldLabel>
                <Controller
                  name="regionId"
                  control={control}
                  render={({ field }) => (
                    <RegionSelect
                      value={field.value}
                      onChange={field.onChange}
                      regions={regions}
                      disabled={loadingRegions}
                    />
                  )}
                />
                <FieldDescription>
                  Where this technician will work.
                </FieldDescription>
              </Field>
            ) : null}
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

function RegionSelect({
  value,
  onChange,
  regions,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  regions: { id: string; name: string }[];
  disabled?: boolean;
}) {
  useAutoSelectSingle(
    regions.map((r) => r.id),
    value,
    onChange,
    !disabled
  );
  const selected = regions.find((r) => r.id === value);

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id="invite-region" className="w-full">
        <SelectValue placeholder="Select a region">
          {() => selected?.name ?? "Select a region"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {regions.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
