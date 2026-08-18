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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCreateVendor, useUpdateVendor } from "@/hooks/useVendors";
import type { Vendor } from "@/types/vendor";
import { StatusField } from "./StatusField";
import { statusOf, vendorSchema, type VendorFormValues } from "./vendorSchema";

interface VendorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. Pass a vendor to edit it in place. */
  vendor?: Vendor;
}

export function VendorFormDialog({
  open,
  onOpenChange,
  vendor,
}: VendorFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the category dialog: this form has a full postal address. */}
      <DialogContent className="sm:max-w-xl">
        {/* The popup unmounts on close, so the form is fresh on every open and
            an edit never opens holding the previous row's values. */}
        <VendorForm vendor={vendor} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** One field, one id — spelled out so the error and hint ids never drift. */
function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <FieldDescription id={id} role="alert" className="text-danger">
      {message}
    </FieldDescription>
  );
}

function VendorForm({
  vendor,
  onDone,
}: {
  vendor?: Vendor;
  onDone: () => void;
}) {
  const isEdit = vendor !== undefined;
  const create = useCreateVendor();
  const update = useUpdateVendor();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: vendor?.name ?? "",
      gstNumber: vendor?.gstNumber ?? "",
      cin: vendor?.cin ?? "",
      contactPerson: vendor?.contactPerson ?? "",
      phone: vendor?.phone ?? "",
      address: vendor?.address ?? "",
      city: vendor?.city ?? "",
      state: vendor?.state ?? "",
      pincode: vendor?.pincode ?? "",
      status: statusOf(vendor?.isActive ?? true),
    },
  });

  function submit(values: VendorFormValues) {
    const body = {
      name: values.name,
      gstNumber: values.gstNumber,
      // An empty box means "not recorded", which the API stores as null —
      // never an empty string.
      cin: values.cin === "" ? null : values.cin,
      contactPerson: values.contactPerson,
      phone: values.phone,
      address: values.address,
      city: values.city,
      state: values.state,
      pincode: values.pincode,
      isActive: values.status === "Active",
    };
    const done = (saved: Vendor) => {
      toast.add({
        title: `${saved.name} ${isEdit ? "updated" : "added"}`,
        description: `${saved.city} · ${saved.isActive ? "Active" : "Paused"}.`,
      });
      onDone();
    };

    if (isEdit) update.mutate({ id: vendor.id, ...body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit vendor" : "Add vendor"}</DialogTitle>
        <DialogDescription>
          The company whose products you install. A vendor becomes a brand you
          can pick when adding a product model.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="scroll-slim -mr-4 max-h-[60vh] gap-4 overflow-y-auto pr-4">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="vendor-name">Company name</FieldLabel>
          <Input
            id="vendor-name"
            placeholder="e.g. Videocon Industries"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "vendor-name-error" : "vendor-name-hint"}
            {...register("name")}
          />
          <FieldDescription id="vendor-name-hint">
            This is the brand shown on every product model you attribute to it.
          </FieldDescription>
          <ErrorText id="vendor-name-error" message={errors.name?.message} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.gstNumber ? true : undefined}>
            <FieldLabel htmlFor="vendor-gst">GSTIN</FieldLabel>
            <Input
              id="vendor-gst"
              placeholder="27AAACV1234A1Z5"
              autoCapitalize="characters"
              aria-invalid={errors.gstNumber ? true : undefined}
              aria-describedby={errors.gstNumber ? "vendor-gst-error" : undefined}
              {...register("gstNumber")}
            />
            <ErrorText id="vendor-gst-error" message={errors.gstNumber?.message} />
          </Field>

          <Field data-invalid={errors.cin ? true : undefined}>
            <FieldLabel htmlFor="vendor-cin">CIN</FieldLabel>
            <Input
              id="vendor-cin"
              placeholder="L32100MH1985PLC123456"
              autoCapitalize="characters"
              aria-invalid={errors.cin ? true : undefined}
              aria-describedby={errors.cin ? "vendor-cin-error" : "vendor-cin-hint"}
              {...register("cin")}
            />
            <FieldDescription id="vendor-cin-hint">
              Optional — only a registered company has one.
            </FieldDescription>
            <ErrorText id="vendor-cin-error" message={errors.cin?.message} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.contactPerson ? true : undefined}>
            <FieldLabel htmlFor="vendor-contact">Contact person</FieldLabel>
            <Input
              id="vendor-contact"
              placeholder="e.g. Rakesh Mehta"
              aria-invalid={errors.contactPerson ? true : undefined}
              aria-describedby={
                errors.contactPerson ? "vendor-contact-error" : undefined
              }
              {...register("contactPerson")}
            />
            <ErrorText
              id="vendor-contact-error"
              message={errors.contactPerson?.message}
            />
          </Field>

          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="vendor-phone">Mobile number</FieldLabel>
            <Input
              id="vendor-phone"
              type="tel"
              inputMode="tel"
              placeholder="98200 11001"
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? "vendor-phone-error" : undefined}
              {...register("phone")}
            />
            <ErrorText id="vendor-phone-error" message={errors.phone?.message} />
          </Field>
        </div>

        <Field data-invalid={errors.address ? true : undefined}>
          <FieldLabel htmlFor="vendor-address">Address</FieldLabel>
          <Textarea
            id="vendor-address"
            rows={3}
            placeholder="Building, street, area"
            aria-invalid={errors.address ? true : undefined}
            aria-describedby={errors.address ? "vendor-address-error" : undefined}
            {...register("address")}
          />
          <ErrorText id="vendor-address-error" message={errors.address?.message} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={errors.city ? true : undefined}>
            <FieldLabel htmlFor="vendor-city">City</FieldLabel>
            <Input
              id="vendor-city"
              placeholder="Mumbai"
              aria-invalid={errors.city ? true : undefined}
              aria-describedby={errors.city ? "vendor-city-error" : undefined}
              {...register("city")}
            />
            <ErrorText id="vendor-city-error" message={errors.city?.message} />
          </Field>

          <Field data-invalid={errors.state ? true : undefined}>
            <FieldLabel htmlFor="vendor-state">State</FieldLabel>
            <Input
              id="vendor-state"
              placeholder="Maharashtra"
              aria-invalid={errors.state ? true : undefined}
              aria-describedby={errors.state ? "vendor-state-error" : undefined}
              {...register("state")}
            />
            <ErrorText id="vendor-state-error" message={errors.state?.message} />
          </Field>

          <Field data-invalid={errors.pincode ? true : undefined}>
            <FieldLabel htmlFor="vendor-pincode">Pincode</FieldLabel>
            <Input
              id="vendor-pincode"
              inputMode="numeric"
              placeholder="400099"
              aria-invalid={errors.pincode ? true : undefined}
              aria-describedby={errors.pincode ? "vendor-pincode-error" : undefined}
              {...register("pincode")}
            />
            <ErrorText id="vendor-pincode-error" message={errors.pincode?.message} />
          </Field>
        </div>

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <StatusField
              value={field.value}
              onChange={field.onChange}
              description="Paused vendors stay out of the brand picker. Models already carrying the brand keep it."
              error={errors.status?.message}
              errorId="vendor-status-error"
            />
          )}
        />
      </FieldGroup>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Add vendor"}
        </Button>
      </DialogFooter>
    </form>
  );
}
