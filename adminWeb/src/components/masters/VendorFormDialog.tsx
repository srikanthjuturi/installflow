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
      {/* Laid out like the superadmin company dialog, and sized like it: three
          columns need the room, and two of these fields are long identifiers
          nobody can proof-read in a narrow box.

          The popup itself scrolls, as that dialog does, so the scrollbar sits
          on the popup wall. Scrolling an inner FieldGroup instead needed a
          negative margin to escape the dialog's padding, and any drift between
          the two left the bar floating in a gutter. */}
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {/* The popup unmounts on close, so the form is fresh on every open and
            an edit never opens holding the previous row's values. */}
        <VendorForm vendor={vendor} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The field grid every section uses — the same one the company dialog lays out
 * with. One column on a phone, two on a tablet, three from `lg` up, written as
 * a static string: an interpolated `grid-cols-${n}` is never generated and the
 * row would silently collapse to one column.
 */
const COLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

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
    // A `FormSection` like every other group, so the heading, the rule and the
    // hint match — the three cards then sit in the same three columns the
    // fields above and below them use.
    <FormSection
      legend="Ticket intake"
      hint={
        <FieldDescription id="vendor-intake-hint" className="mt-0">
          How this vendor&apos;s tickets reach you. Pick every way that applies.
        </FieldDescription>
      }
      data-invalid={error ? true : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? "vendor-intake-error" : "vendor-intake-hint"}
    >
      <div className={COLS}>
        {options.map((option) => {
          const checked = value.includes(option.value);
          const disabled = isPending || !option.available;
          const screen = CHANNEL_SCREEN[option.value];
          return (
            <label
              key={option.value}
              aria-disabled={disabled || undefined}
              className={cn(
                "flex h-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
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
    </FormSection>
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

  /**
   * One field, one id — so the label, the hint and the error can never point at
   * different things. `autoComplete` is off unless a caller says otherwise:
   * nothing here belongs to the operator, so the browser offering THEIR company
   * and phone would be filling the wrong company's record.
   */
  const renderField = (
    name: keyof VendorFormValues,
    label: React.ReactNode,
    opts?: {
      hint?: string;
      type?: string;
      placeholder?: string;
      inputMode?: "tel" | "numeric";
      maxLength?: number;
      password?: boolean;
      textarea?: boolean;
      rows?: number;
      /** Shown but not editable — an identity the account is looked up by. */
      readOnly?: boolean;
      /** A statutory identifier: mono and wide-tracked, so a transposed
       *  character is visible rather than lost in a run of caps. */
      mono?: boolean;
      tabular?: boolean;
      /** Column span inside the three-column grid — for the one field that
       *  genuinely needs the room, like a street address. */
      className?: string;
    }
  ) => {
    const id = `vendor-${name}`;
    const message = errors[name]?.message;
    const describedBy = message
      ? `${id}-error`
      : opts?.hint
        ? `${id}-hint`
        : undefined;
    return (
      <Field
        data-invalid={message ? true : undefined}
        className={opts?.className}
      >
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {opts?.textarea ? (
          <Textarea
            id={id}
            rows={opts.rows ?? 2}
            className="resize-y"
            placeholder={opts.placeholder}
            aria-invalid={message ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        ) : opts?.password ? (
          <PasswordInput
            id={id}
            autoComplete="new-password"
            aria-invalid={message ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        ) : (
          <Input
            id={id}
            type={opts?.type}
            inputMode={opts?.inputMode}
            maxLength={opts?.maxLength}
            readOnly={opts?.readOnly}
            disabled={opts?.readOnly}
            autoComplete="off"
            autoCapitalize={opts?.mono ? "characters" : undefined}
            spellCheck={opts?.mono ? false : undefined}
            className={cn(
              opts?.mono && "font-mono tracking-wide uppercase",
              opts?.tabular && "tabular-nums"
            )}
            placeholder={opts?.placeholder}
            aria-invalid={message ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        )}
        {opts?.hint && !message ? (
          <FieldDescription id={`${id}-hint`}>{opts.hint}</FieldDescription>
        ) : null}
        {message ? (
          <FieldDescription
            id={`${id}-error`}
            role="alert"
            className="text-danger"
          >
            {message}
          </FieldDescription>
        ) : null}
      </Field>
    );
  };

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
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit vendor" : "Add vendor"}</DialogTitle>
        <DialogDescription>
          The company whose products you install. A vendor becomes a brand you
          can pick when adding a product model.
        </DialogDescription>
      </DialogHeader>

      {/* Five sections rather than twelve loose fields. Each is answered from
          one place — the letterhead, the GST certificate, a phone, an envelope
          — and each row of three is one of those places. */}
      <FormSection legend="Company">
        <FieldGroup className={COLS}>
          {renderField("name", "Company name", {
            placeholder: "e.g. Videocon Industries",
            hint: "This is the brand shown on every product model you attribute to it.",
          })}
          {renderField("contactPerson", "Contact person", {
            placeholder: "e.g. Rakesh Mehta",
            hint: "Who ops call about a delivery, a part or a warranty claim.",
          })}
          {renderField("phone", "Mobile number", {
            type: "tel",
            inputMode: "tel",
            tabular: true,
            placeholder: "98200 11001",
            hint: "10 digits. Spaces and a +91 are fine.",
          })}
        </FieldGroup>
      </FormSection>

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

      <FormSection
        legend="Statutory identity"
        hint="As printed on the GST certificate. Both are stored in upper case."
      >
        <FieldGroup className={COLS}>
          {renderField("gstNumber", "GSTIN", {
            mono: true,
            maxLength: 15,
            placeholder: "27AAACV1234A1Z5",
          })}
          {renderField(
            "cin",
            <>
              CIN <OptionalTag />
            </>,
            {
              mono: true,
              maxLength: 21,
              placeholder: "L32100MH1985PLC123456",
              hint: "Only an MCA-registered company has one.",
            }
          )}
        </FieldGroup>
      </FormSection>

      <FormSection legend="Registered address">
        <FieldGroup className={COLS}>
          {/* The street line takes the whole row: it is the longest value on
              the form, and the only one where a line break carries meaning. */}
          {renderField("address", "Building, street and area", {
            textarea: true,
            placeholder: "Videocon House, 14th Floor\nChakala, Andheri East",
            hint: "Paste it straight off the letterhead — line breaks are kept.",
            className: "sm:col-span-2 lg:col-span-3",
          })}
          {renderField("city", "City", { placeholder: "Mumbai" })}
          {renderField("state", "State", { placeholder: "Maharashtra" })}
          {renderField("pincode", "Pincode", {
            inputMode: "numeric",
            tabular: true,
            maxLength: 6,
            placeholder: "400099",
          })}
        </FieldGroup>
      </FormSection>

      <FormSection legend="Portal access">
        <FieldGroup className={COLS}>
          {renderField("loginEmail", "Login email", {
            type: "email",
            placeholder: "ops@vendor.com",
            // Read-only on edit: this is the identity the account is looked up
            // by, and moving it would strand the vendor on credentials nobody
            // recorded. The server does not accept a change either.
            readOnly: isEdit,
            hint: isEdit
              ? "The address this vendor signs in with."
              : "They sign in with this and raise their own tickets.",
          })}
          {renderField("password", isEdit ? "New password" : "Temporary password", {
            password: true,
            hint: isEdit
              ? "Leave blank to keep the current one. Setting a new password signs the vendor out everywhere."
              : "At least 8 characters. Share it so they can sign in.",
          })}
        </FieldGroup>
      </FormSection>

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
