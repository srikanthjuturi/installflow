import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FormSection } from "@/components/shared/FormSection";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  useCreateVendor,
  useIntakeChannels,
  useUpdateVendor,
} from "@/hooks/useVendors";
import { cn } from "@/lib/utils";
import type {
  IntakeChannel,
  IntakeChannelOption,
  Vendor,
} from "@/types/vendor";
import { StatusField } from "./StatusField";
import {
  CHANNEL_HINT,
  CHANNEL_SCREEN,
  INTAKE_CHANNELS,
  LOCAL_AVAILABLE,
  statusOf,
  addVendorSchema,
  editVendorSchema,
  type VendorFormValues,
} from "./vendorSchema";

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
  // A thin alias for the shared component: this file names its sections in six
  // places and `Section` reads better beside them than the fully qualified one.
  return (
    <FormSection legend={legend} hint={hint}>
      {children}
    </FormSection>
  );
}

/** Says "optional" once, in the label, rather than in prose under every box. */
function OptionalTag() {
  return (
    <span className="ml-1 text-[11px] font-normal text-ink-3">optional</span>
  );
}

/**
 * How this vendor's tickets reach us — §4's three channels, several at once.
 *
 * A checkbox group rather than a select, for three reasons a `<Select>` cannot
 * cover: a vendor may use more than one channel, each option needs its own line
 * of explanation, and one of them has to be shown as unavailable WITH a reason.
 *
 * The unavailable option stays visible and greyed rather than hidden. The
 * requirement document promises three channels; a missing one reads as a bug,
 * where a disabled one with a reason reads as a roadmap.
 *
 * Availability comes from the server, never from a constant here, so the day
 * API intake ships this file does not change.
 */
function IntakeChannelField({
  value,
  onChange,
  error,
}: {
  value: IntakeChannel[];
  onChange: (next: IntakeChannel[]) => void;
  error?: string;
}) {
  const { data, isPending, isError } = useIntakeChannels();

  /*
   * Three states, and they must not be conflated.
   *
   * Loading  — render the three we know, disabled, so the list never flashes
   *            empty or unlabelled while the request is in flight.
   * Loaded   — the server is the authority.
   * FAILED   — fall back to LOCAL_AVAILABLE rather than leaving everything
   *            disabled. Treating a failed fetch as "nothing is available" put
   *            "Coming soon" on Excel and Manual and made the whole form
   *            unsubmittable, and `staleTime: Infinity` meant it never quietly
   *            recovered. The fallback errs safe: it can only ever offer FEWER
   *            channels than the server would, never more, and the server
   *            refuses anything it disagrees with regardless.
   */
  const options: IntakeChannelOption[] =
    data ??
    INTAKE_CHANNELS.map((value) => ({
      value,
      description: CHANNEL_HINT[value],
      available: isError ? LOCAL_AVAILABLE.includes(value) : false,
      unavailableReason: null,
    }));

  function toggle(channel: IntakeChannel, checked: boolean) {
    // Rebuilt from INTAKE_CHANNELS rather than appended, so the stored order is
    // always catalogue order however the boxes were clicked.
    const next = new Set(value);
    if (checked) next.add(channel);
    else next.delete(channel);
    onChange(INTAKE_CHANNELS.filter((c) => next.has(c)));
  }

  return (
    <FieldSet
      className="gap-4"
      data-invalid={error ? true : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? "vendor-intake-error" : "vendor-intake-hint"}
    >
      <div className="grid gap-0.5">
        <FieldLegend variant="label" className="mb-0 text-ink">
          Ticket intake
        </FieldLegend>
        <FieldDescription id="vendor-intake-hint" className="mt-0">
          How this vendor&apos;s tickets reach you. Pick every way that applies.
        </FieldDescription>
      </div>

      <div className="grid gap-2">
        {options.map((option) => {
          const checked = value.includes(option.value);
          const disabled = isPending || !option.available;
          const screen = CHANNEL_SCREEN[option.value];
          return (
            <label
              key={option.value}
              aria-disabled={disabled || undefined}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                disabled
                  ? "cursor-not-allowed border-line bg-surface-2 opacity-70"
                  : checked
                    ? "border-brand-500 bg-brand-100/40"
                    : "border-line hover:border-brand-400"
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) => toggle(option.value, next === true)}
              />
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  {option.value}
                  {/* Never colour alone — the word "Coming soon" carries it. */}
                  {!option.available && !isPending ? (
                    <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-semibold text-warn">
                      Coming soon
                    </span>
                  ) : null}
                  {screen && option.available ? (
                    <span className="text-[11px] font-normal text-ink-3">
                      via {screen}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-2">{option.description}</span>
                {option.unavailableReason ? (
                  <span className="text-xs text-ink-3">
                    {option.unavailableReason}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      {error ? (
        <FieldDescription
          id="vendor-intake-error"
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : null}
    </FieldSet>
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
    resolver: zodResolver(isEdit ? editVendorSchema : addVendorSchema),
    defaultValues: {
      name: vendor?.name ?? "",
      loginEmail: vendor?.loginEmail ?? "",
      // Never pre-filled, on either path: on add there is nothing to show, and
      // on edit a blank box is what "leave it alone" looks like.
      password: "",
      gstNumber: vendor?.gstNumber ?? "",
      cin: vendor?.cin ?? "",
      contactPerson: vendor?.contactPerson ?? "",
      phone: vendor?.phone ?? "",
      address: vendor?.address ?? "",
      city: vendor?.city ?? "",
      state: vendor?.state ?? "",
      pincode: vendor?.pincode ?? "",
      // Manual by default: the one channel that is always true, since somebody
      // can always type a ticket in.
      intakeChannels: vendor?.intakeChannels ?? ["Manual"],
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
      intakeChannels: values.intakeChannels,
      isActive: values.status === "Active",
    };
    const done = (saved: Vendor) => {
      toast.add({
        title: `${saved.name} ${isEdit ? "updated" : "added"}`,
        description: `Intake ${saved.intakeChannels.join(" + ")} · ${
          saved.isActive ? "Active" : "Paused"
        }.`,
      });
      onDone();
    };

    if (isEdit) {
      update.mutate(
        {
          id: vendor.id,
          ...body,
          // Omitted entirely when blank, so the API leaves the password alone
          // rather than being asked to set it to "".
          ...(values.password ? { password: values.password } : {}),
        },
        { onSuccess: done }
      );
    } else {
      create.mutate(
        { ...body, loginEmail: values.loginEmail, password: values.password },
        { onSuccess: done }
      );
    }
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

        <Controller
          name="intakeChannels"
          control={control}
          render={({ field }) => (
            <IntakeChannelField
              value={field.value}
              onChange={field.onChange}
              error={errors.intakeChannels?.message}
            />
          )}
        />

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

        <Section legend="Portal access">
          <Field data-invalid={errors.loginEmail ? true : undefined}>
            <FieldLabel htmlFor="vendor-login">Login email</FieldLabel>
            <Input
              id="vendor-login"
              type="email"
              autoComplete="off"
              placeholder="ops@vendor.com"
              // Read-only on edit: this is the identity the account is looked
              // up by, and moving it would strand the vendor on credentials
              // nobody recorded. The server does not accept a change either.
              readOnly={isEdit}
              disabled={isEdit}
              aria-invalid={errors.loginEmail ? true : undefined}
              aria-describedby={
                errors.loginEmail ? "vendor-login-error" : "vendor-login-hint"
              }
              {...register("loginEmail")}
            />
            <FieldDescription id="vendor-login-hint">
              {isEdit
                ? "The address this vendor signs in with."
                : "They sign in with this and raise their own tickets."}
            </FieldDescription>
            <ErrorText
              id="vendor-login-error"
              message={errors.loginEmail?.message}
            />
          </Field>

          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="vendor-password">
              {isEdit ? "New password" : "Temporary password"}
            </FieldLabel>
            <PasswordInput
              id="vendor-password"
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={
                errors.password ? "vendor-password-error" : "vendor-password-hint"
              }
              {...register("password")}
            />
            <FieldDescription id="vendor-password-hint">
              {isEdit
                ? "Leave blank to keep the current one. Setting a new password signs the vendor out everywhere."
                : "At least 8 characters. Share it so they can sign in."}
            </FieldDescription>
            <ErrorText
              id="vendor-password-error"
              message={errors.password?.message}
            />
          </Field>
        </Section>

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
