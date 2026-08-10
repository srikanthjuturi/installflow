import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
import type { PartnerKind } from "@/types/partner";
import {
  EMPTY_INVITE,
  partnerInviteSchema,
  type PartnerInviteValues,
} from "./partnerSchema";

interface PartnerInviteDialogProps {
  kind: PartnerKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PartnerInviteValues) => void;
  isSubmitting: boolean;
}

/**
 * The invite goes out over WhatsApp, so the number needs a country code, and
 * the partner needs a region — that is what decides who can see them later.
 * Someone who holds exactly one region doesn't pick: theirs is used.
 */
export function PartnerInviteDialog({
  kind,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: PartnerInviteDialogProps) {
  const { regions, isLoading } = useAssignableRegions();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PartnerInviteValues>({
    resolver: zodResolver(partnerInviteSchema),
    mode: "onChange",
    defaultValues: EMPTY_INVITE,
  });

  // The dialog stays mounted, so a reopened form would otherwise still hold
  // the last attempt.
  useEffect(() => {
    if (open) reset(EMPTY_INVITE);
  }, [open, reset]);

  const label = kind === "Freelancer" ? "freelancer" : "franchise";
  const mustPickRegion = regions.length !== 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Invite {label}</DialogTitle>
            <DialogDescription>
              A WhatsApp invite goes to this number with a link to install the
              technician app. The {label} completes the rest of the profile from
              it.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <Field data-invalid={errors.phone ? true : undefined}>
              <FieldLabel htmlFor="partner-phone">Mobile number</FieldLabel>
              <Input
                id="partner-phone"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="+91 98765 43210"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={
                  errors.phone ? "partner-phone-error" : "partner-phone-hint"
                }
                {...register("phone")}
              />
              {errors.phone ? (
                <FieldDescription
                  id="partner-phone-error"
                  role="alert"
                  className="text-danger"
                >
                  {errors.phone.message}
                </FieldDescription>
              ) : (
                <FieldDescription id="partner-phone-hint">
                  Must be on WhatsApp. Include the country code.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={errors.fullName ? true : undefined}>
              <FieldLabel htmlFor="partner-name">Name (optional)</FieldLabel>
              <Input
                id="partner-name"
                autoComplete="name"
                placeholder="Who is this?"
                {...register("fullName")}
              />
              <FieldDescription>
                Only to recognise them in this list before they register.
              </FieldDescription>
            </Field>

            {mustPickRegion ? (
              <Field data-invalid={errors.regionId ? true : undefined}>
                <FieldLabel htmlFor="partner-region">Region</FieldLabel>
                <Controller
                  name="regionId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="partner-region" className="w-full">
                        <SelectValue
                          placeholder={
                            isLoading ? "Loading regions…" : "Select a region"
                          }
                        >
                          {(v) =>
                            regions.find((r) => r.id === v)?.name ??
                            "Select a region"
                          }
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
                  )}
                />
                <FieldDescription>
                  Where this {label} will work.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
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
