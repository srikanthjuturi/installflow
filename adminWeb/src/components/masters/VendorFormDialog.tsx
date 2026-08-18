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
  FieldLegend,
  FieldSeparator,
  FieldSet,
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
      {/* The widest dialog in the console, and it earns it: ten fields, four of
          which are long identifiers nobody can proof-read in a 32rem column.
          A GSTIN and a CIN each want their own full-width line at this size. */}
      <DialogContent className="sm:max-w-3xl">
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

/**
 * A titled group of fields.
 *
 * A real `fieldset`/`legend`, not a styled div, so a screen reader announces
 * "Statutory identity, group" as it enters and the four sections are navigable
 * rather than one flat run of ten inputs.
 */
function Section({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <FieldSet className="gap-5">
      <div className="grid gap-0.5">
        <FieldLegend variant="label" className="mb-0 text-ink">
          {legend}
        </FieldLegend>
        {hint ? (
          <FieldDescription className="mt-0">{hint}</FieldDescription>
        ) : null}
      </div>
      {children}
    </FieldSet>
  );
}

/** Says "optional" once, in the label, rather than in prose under every box. */
function OptionalTag() {
  return (
    <span className="ml-1 text-[11px] font-normal text-ink-3">optional</span>
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

      {/* `-mr-6 pr-6` cancels the dialog's own padding on this edge only, so the
          scrollbar rides the popup wall instead of floating in a gutter, while
          the fields keep their inset. */}
      <FieldGroup className="scroll-slim -mr-6 max-h-[62vh] gap-6 overflow-y-auto pr-6">
        {/* Four sections rather than ten loose fields. Ten in a row is a wall
            somebody scrolls past; grouped, each is answered from one place —
            the letterhead, the GST certificate, a phone, an envelope. */}
        <Section legend="Company">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="vendor-name">Company name</FieldLabel>
            <Input
              id="vendor-name"
              placeholder="e.g. Videocon Industries"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={
                errors.name ? "vendor-name-error" : "vendor-name-hint"
              }
              {...register("name")}
            />
            <FieldDescription id="vendor-name-hint">
              This is the brand shown on every product model you attribute to it.
            </FieldDescription>
            <ErrorText id="vendor-name-error" message={errors.name?.message} />
          </Field>
        </Section>

        <FieldSeparator />

        <Section
          legend="Statutory identity"
          hint="As printed on the GST certificate. Both are stored in upper case."
        >
          {/* Side by side: at this dialog width each column still holds all 21
              characters of a CIN without scrolling, and stacking them pushed
              the address below the fold. `font-mono` and wide tracking so a
              transposed digit is visible rather than lost in a run of caps. */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={errors.gstNumber ? true : undefined}>
              <FieldLabel htmlFor="vendor-gst">GSTIN</FieldLabel>
              <Input
                id="vendor-gst"
                className="font-mono tracking-wide uppercase"
                placeholder="27AAACV1234A1Z5"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={15}
                aria-invalid={errors.gstNumber ? true : undefined}
                aria-describedby={
                  errors.gstNumber ? "vendor-gst-error" : undefined
                }
                {...register("gstNumber")}
              />
              <ErrorText
                id="vendor-gst-error"
                message={errors.gstNumber?.message}
              />
            </Field>

            <Field data-invalid={errors.cin ? true : undefined}>
              <FieldLabel htmlFor="vendor-cin">
                CIN <OptionalTag />
              </FieldLabel>
              <Input
                id="vendor-cin"
                className="font-mono tracking-wide uppercase"
                placeholder="L32100MH1985PLC123456"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={21}
                aria-invalid={errors.cin ? true : undefined}
                aria-describedby={
                  errors.cin ? "vendor-cin-error" : "vendor-cin-hint"
                }
                {...register("cin")}
              />
              <FieldDescription id="vendor-cin-hint">
                Only an MCA-registered company has one.
              </FieldDescription>
              <ErrorText id="vendor-cin-error" message={errors.cin?.message} />
            </Field>
          </div>
        </Section>

        <FieldSeparator />

        <Section
          legend="Contact"
          hint="Who ops call about a delivery, a part or a warranty claim."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={errors.contactPerson ? true : undefined}>
              <FieldLabel htmlFor="vendor-contact">Contact person</FieldLabel>
              <Input
                id="vendor-contact"
                placeholder="e.g. Rakesh Mehta"
                autoComplete="off"
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
                autoComplete="off"
                className="tabular-nums"
                placeholder="98200 11001"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={
                  errors.phone ? "vendor-phone-error" : "vendor-phone-hint"
                }
                {...register("phone")}
              />
              <FieldDescription id="vendor-phone-hint">
                10 digits. Spaces and a +91 are fine.
              </FieldDescription>
              <ErrorText id="vendor-phone-error" message={errors.phone?.message} />
            </Field>
          </div>
        </Section>

        <FieldSeparator />

        <Section legend="Registered address">
          <Field data-invalid={errors.address ? true : undefined}>
            <FieldLabel htmlFor="vendor-address">
              Building, street and area
            </FieldLabel>
            <Textarea
              id="vendor-address"
              rows={3}
              className="resize-y"
              placeholder={"Videocon House, 14th Floor\nChakala, Andheri East"}
              aria-invalid={errors.address ? true : undefined}
              aria-describedby={
                errors.address ? "vendor-address-error" : "vendor-address-hint"
              }
              {...register("address")}
            />
            <FieldDescription id="vendor-address-hint">
              Paste it straight off the letterhead — line breaks are kept.
            </FieldDescription>
            <ErrorText id="vendor-address-error" message={errors.address?.message} />
          </Field>

          {/* City and state take the room; the pincode is six digits and does
              not need a third of the row. */}
          <div className="grid gap-5 sm:grid-cols-[1fr_1fr_9rem]">
            <Field data-invalid={errors.city ? true : undefined}>
              <FieldLabel htmlFor="vendor-city">City</FieldLabel>
              <Input
                id="vendor-city"
                placeholder="Mumbai"
                autoComplete="off"
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
                autoComplete="off"
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
                autoComplete="off"
                className="tabular-nums"
                placeholder="400099"
                maxLength={6}
                aria-invalid={errors.pincode ? true : undefined}
                aria-describedby={
                  errors.pincode ? "vendor-pincode-error" : undefined
                }
                {...register("pincode")}
              />
              <ErrorText
                id="vendor-pincode-error"
                message={errors.pincode?.message}
              />
            </Field>
          </div>
        </Section>

        <FieldSeparator />

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
