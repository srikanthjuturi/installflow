import { Controller, useForm, useWatch } from "react-hook-form";
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
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useUpdateUser } from "@/hooks/useCompanyUsers";
import { cn } from "@/lib/utils";
import type { CompanyUser } from "@/types/user";
import { ScopeField } from "./ScopeField";
import { editUserResolver, type EditUserValues } from "./companyUserSchema";

export function EditUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: CompanyUser;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {user ? (
          <EditUserForm
            key={user.membershipId}
            user={user}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({
  user,
  onDone,
}: {
  user: CompanyUser;
  onDone: () => void;
}) {
  const update = useUpdateUser();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<EditUserValues>({
    resolver: editUserResolver(user.role),
    mode: "onChange",
    defaultValues: {
      fullName: user.fullName ?? "",
      phone: user.phone ?? "",
      isActive: user.isActive,
      regionIds: user.regions.map((r) => r.id),
      pincodes: user.pincodes,
    },
  });

  const err = (name: keyof EditUserValues) => errors[name]?.message;
  // Only the scope fields drive conditional UI, so only those are watched.
  const regionIds = useWatch({ control, name: "regionIds" });
  const pincodes = useWatch({ control, name: "pincodes" });

  function submit(values: EditUserValues) {
    update.mutate(
      {
        id: user.membershipId,
        input: {
          fullName: values.fullName.trim(),
          phone: values.phone.trim() || null,
          isActive: values.isActive,
          regionIds: values.regionIds,
          pincodes: values.pincodes,
        },
      },
      {
        onSuccess: (u) => {
          toast.add({ title: `${u.fullName ?? u.email} updated` });
          onDone();
        },
      }
    );
  }

  return (
<form onSubmit={handleSubmit(submit)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Edit {user.fullName ?? user.email}</DialogTitle>
        <DialogDescription>
          {user.email} · {user.roleLabel} — role and email can&apos;t be changed
          here.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={err("fullName") ? true : undefined}>
          <FieldLabel htmlFor="fullName">Full name</FieldLabel>
          <Input
            id="fullName"
            autoComplete="name"
            aria-invalid={err("fullName") ? true : undefined}
            {...register("fullName")}
          />
          {err("fullName") ? (
            <FieldDescription role="alert" className="text-danger">
              {err("fullName")}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={err("phone") ? true : undefined}>
          <FieldLabel htmlFor="phone">Phone</FieldLabel>
          <Input
            id="phone"
            placeholder="+91 90000 00000"
            autoComplete="tel"
            aria-invalid={err("phone") ? true : undefined}
            {...register("phone")}
          />
          {err("phone") ? (
            <FieldDescription role="alert" className="text-danger">
              {err("phone")}
            </FieldDescription>
          ) : null}
        </Field>

        <ScopeField
          role={user.role}
          regionIds={regionIds}
          pincodes={pincodes}
          onRegionIds={(next) =>
            setValue("regionIds", next, { shouldValidate: true })
          }
          onPincodes={(next) =>
            setValue("pincodes", next, { shouldValidate: true })
          }
          regionError={err("regionIds")}
          pincodeError={err("pincodes")}
        />

        <FieldSet>
          <FieldLegend variant="label" className="text-sm font-medium">
            Status
          </FieldLegend>
          <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
              <RadioGroup
                aria-label="Status"
                value={field.value ? "active" : "suspended"}
                onValueChange={(v) => field.onChange(v === "active")}
                className="grid grid-cols-2 gap-2.5"
              >
                {[
                  { value: "active", label: "Active" },
                  { value: "suspended", label: "Suspended" },
                ].map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
                      (field.value ? "active" : "suspended") === o.value
                        ? "border-brand-500 bg-brand-100/40"
                        : "border-line hover:border-brand-400"
                    )}
                  >
                    <RadioGroupItem value={o.value} />
                    <span>{o.label}</span>
                  </label>
                ))}
              </RadioGroup>
            )}
          />
          <FieldDescription>
            Suspended users can&apos;t sign in to this company.
          </FieldDescription>
        </FieldSet>
      </FieldGroup>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
