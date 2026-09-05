import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
  FieldLabel,
} from "@/components/ui/field";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { FormSection } from "@/components/shared/FormSection";
import { useFieldConflict } from "@/components/shared/useFieldConflict";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useGstinLookup } from "@/hooks/useGstinLookup";
import {
  useCreateVendor,
  useIntakeChannels,
  useUpdateVendor,
} from "@/hooks/useVendors";
import { VENDOR_GST_CODES } from "@/lib/errorCodes";
import { cn } from "@/lib/utils";
import type {
  CreatedVendor,
  IntakeChannel,
  IntakeChannelOption,
  Vendor,
} from "@/types/vendor";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
import { AddressSearchField } from "./AddressSearchField";
import { LocationCheckField } from "./LocationCheckField";
import { StatusField } from "./StatusField";
import {
  CHANNEL_HINT,
  CHANNEL_SCREEN,
  GSTIN_RE,
  INTAKE_CHANNELS,
  LOCAL_AVAILABLE,
  addressSearchOf,
  locationCheckOf,
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
  // Set when the login's password email did not go out — the dialog then shows
  // the password instead of the form. See TemporaryPasswordPanel for why this
  // cannot be a toast.
  const [undelivered, setUndelivered] = useState<CreatedVendor | null>(null);

  function close() {
    onOpenChange(false);
    setTimeout(() => setUndelivered(null), 200);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      {/* Laid out like the superadmin company dialog, and sized like it: three
          columns need the room, and two of these fields are long identifiers
          nobody can proof-read in a narrow box.

          The popup itself scrolls, as that dialog does, so the scrollbar sits
          on the popup wall. Scrolling an inner FieldGroup instead needed a
          negative margin to escape the dialog's padding, and any drift between
          the two left the bar floating in a gutter. */}
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {undelivered ? (
          <TemporaryPasswordPanel
            heading="Added, but the email didn't send"
            email={undelivered.loginEmail ?? ""}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          /* The popup unmounts on close, so the form is fresh on every open and
             an edit never opens holding the previous row's values. */
          <VendorForm
            vendor={vendor}
            onDone={close}
            onUndelivered={setUndelivered}
          />
        )}
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

/**
 * Two columns, for the rows that pair a two-card boolean with something else.
 * Half of this dialog, not a third: each `ChoiceCards` holds two bordered cards
 * side by side plus a sentence of explanation, and a third of the width squeezes
 * both. Also written out in full for the same reason `COLS` is.
 */
const PAIR = "grid gap-4 sm:grid-cols-2";

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
      required
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
  onUndelivered,
}: {
  vendor?: Vendor;
  onDone: () => void;
  onUndelivered: (created: CreatedVendor) => void;
}) {
  const isEdit = vendor !== undefined;
  const create = useCreateVendor();
  const update = useUpdateVendor();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<VendorFormValues>({
    resolver: zodResolver(isEdit ? editVendorSchema : addVendorSchema),
    defaultValues: {
      name: vendor?.name ?? "",
      loginEmail: vendor?.loginEmail ?? "",
      gstNumber: vendor?.gstNumber ?? "",
      pan: vendor?.pan ?? "",
      cin: vendor?.cin ?? "",
      gstCompanyStatus: vendor?.gstCompanyStatus ?? "",
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
      // On by default, like Active — and for a reason worth knowing before
      // anybody turns it off. Only a picked search result puts coordinates on a
      // ticket, and without them a technician's live photo is checked against
      // the pincode rather than the metres. Off is a real decision, not a saving.
      addressSearch: addressSearchOf(vendor?.addressSearchEnabled ?? true),
      // On by default too, so nothing changes for a vendor nobody edits. Off is
      // for sites that cannot produce a GPS fix at all, where the alternative is
      // a technician who cannot start a job they are standing at.
      locationCheck: locationCheckOf(vendor?.locationCheckEnabled ?? true),
    },
  });

  // A GSTIN clash is only knowable at the server: it can be the number of
  // another vendor here, or the company's own. Both come back 409 and belong on
  // the GSTIN box, not only in the toaster.
  const gstConflict = useFieldConflict();
  const gstValue = useWatch({ control, name: "gstNumber" });

  /*
   * ── Autofill from the GST registry ──────────────────────────────────────
   *
   * This is why Statutory identity leads the form: the GSTIN identifies the
   * company, so the name, the PAN, the registration's standing and the
   * registered address are all answerable from it.
   *
   * Three things keep the spend honest. The call is gated on a COMPLETE GSTIN,
   * so no partial value is ever asked about; it is debounced, so pasting one
   * and typing one both cost exactly one call; and on an EDIT it does not fire
   * until the number actually differs from the saved one — opening a vendor to
   * change its phone would otherwise buy the registry's opinion of a GSTIN
   * whose name, PAN and status we already store, and the autofill only ever
   * fills empty boxes, so it would have nothing to do with the answer. The hook
   * then holds it for the session — see `useGstinLookup`.
   */
  const savedGstin = (vendor?.gstNumber ?? "").trim().toUpperCase();
  const gstin = (gstValue ?? "").trim().toUpperCase();
  const debouncedGstin = useDebouncedValue(gstin, 400);
  const gstinAsked =
    GSTIN_RE.test(debouncedGstin) && debouncedGstin !== savedGstin;
  // `vendor.id` excluded, so the server does not report this vendor's own
  // number as a clash with itself. Belt and braces alongside the gate above,
  // which already stops the unchanged value being asked about: the two guard
  // different things, and only this one survives somebody typing the number
  // out again character by character.
  const gstLookup = useGstinLookup(
    debouncedGstin,
    gstinAsked,
    "vendor",
    vendor?.id
  );

  /** The GSTIN already filled from — without it this fights the user's typing. */
  const filledFrom = useRef<string | null>(null);

  useEffect(() => {
    const found = gstLookup.data;
    if (!found || found.outcome !== "found") return;
    if (filledFrom.current === debouncedGstin) return;
    filledFrom.current = debouncedGstin;

    /*
     * ADDING fills everything. EDITING fills only what is empty.
     *
     * A saved vendor's fields may have been corrected by hand, and a postal
     * address deliberately different from the registered one is an ordinary
     * thing — so an edit never overwrites. What the registry says is shown
     * under the GSTIN instead, where a disagreement is visible and nothing is
     * destroyed to make it so.
     */
    const fill = (
      name:
        | "name"
        | "pan"
        | "gstCompanyStatus"
        | "address"
        | "city"
        | "state"
        | "pincode",
      value: string | null
    ) => {
      if (!value) return;
      if (isEdit && (getValues(name) ?? "").trim() !== "") return;
      setValue(name, value, { shouldDirty: true, shouldValidate: true });
    };

    fill("name", found.name);
    fill("pan", found.pan);
    fill("gstCompanyStatus", found.gstCompanyStatus);
    fill("address", found.address);
    fill("city", found.city);
    fill("state", found.state);
    fill("pincode", found.pincode);
  }, [gstLookup.data, debouncedGstin, isEdit, getValues, setValue]);

  /**
   * We already hold it — another vendor here, or the company's own number.
   * Answered from our own tables without spending a lookup, and it blocks the
   * save the same way the 409 behind it would; `reason` is the sentence that
   * 409 carries, so the two paths read identically.
   */
  const gstAlreadyRegistered =
    gstinAsked && gstLookup.data?.outcome === "already_registered";

  /**
   * A real answer about the GSTIN: it is not registered. Blocks the save — a
   * vendor is a party we invoice against, and an unregistered number is
   * cheaper to refuse now than to find at invoicing.
   */
  const gstNotRegistered =
    gstinAsked && gstLookup.data?.outcome === "not_registered";

  /**
   * We could not ask — our subscription, or the portal. **Blocks nothing.**
   * `isError` (the request failed) and `unavailable` (the API answered 200 and
   * said so) are one thing to the person filling the form in.
   */
  const gstUnavailable =
    gstinAsked &&
    (gstLookup.isError || gstLookup.data?.outcome === "unavailable");

  /** Every reason the GSTIN box refuses before the save is even attempted. */
  const gstRefusal = gstAlreadyRegistered || gstNotRegistered;

  /**
   * What goes on the GSTIN box. A refusal the lookup just made beats a 409 kept
   * from an earlier save: it is about the value in the box right now.
   *
   * "Already registered" comes before "not registered" only for tidiness —
   * they cannot both be true, since a number we hold is never asked about
   * upstream at all.
   */
  const gstError = (() => {
    if (gstAlreadyRegistered)
      return gstLookup.data?.reason ?? "That GSTIN is already registered here";
    if (gstNotRegistered)
      return gstLookup.data?.reason ?? "That GSTIN is not registered";
    return gstConflict.messageFor(gstValue);
  })();

  /** The line under the GSTIN: what the registry said, or why it did not. */
  const gstNote = (() => {
    if (!gstinAsked) return null;
    if (gstLookup.isFetching)
      // Not "checking with the GST portal" any more: the first half of this
      // request asks our own records, and a number we already hold never
      // reaches the portal at all.
      return { tone: "muted" as const, text: "Checking this GSTIN…" };
    if (gstUnavailable)
      return {
        tone: "warn" as const,
        text: "Couldn't check this GSTIN right now — fill the rest in by hand.",
      };
    const found = gstLookup.data;
    if (found?.outcome !== "found") return null;

    const text = [
      found.name,
      // Only ever sent when it differs from the trading name.
      found.legalName,
      found.gstCompanyStatus,
      found.state,
    ]
      .filter(Boolean)
      .join(" · ");

    // Never colour alone — the status word carries the meaning, and the
    // cancellation date is named rather than implied.
    if ((found.gstCompanyStatus ?? "").toLowerCase() === "active")
      return { tone: "ok" as const, text };
    return {
      tone: "warn" as const,
      text: found.cancellationDate
        ? `${text} · cancelled ${found.cancellationDate}`
        : text,
    };
  })();

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
      /** Draws the red asterisk. Mirrors `vendorSchema` — never guess. */
      required?: boolean;
      hint?: string;
      type?: string;
      placeholder?: string;
      inputMode?: "tel" | "numeric";
      maxLength?: number;
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
      /** A rejection the schema could not have known about — a server 409.
       *  Zod wins if both are present: a malformed value is the nearer
       *  problem, and the stale conflict clears as soon as it is fixed. */
      error?: string;
      /** A line that is NOT a rejection: what a lookup found, or why it could
       *  not ask. Sits under the hint and carries its own tone, so "we could
       *  not check" never reads like "this is wrong". */
      note?: { text: string; tone: "muted" | "ok" | "warn" } | null;
    }
  ) => {
    const id = `vendor-${name}`;
    const message = errors[name]?.message ?? opts?.error;
    const describedBy =
      [
        message ? `${id}-error` : opts?.hint ? `${id}-hint` : null,
        opts?.note ? `${id}-note` : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <Field
        data-invalid={message ? true : undefined}
        className={opts?.className}
      >
        <FieldLabel htmlFor={id} required={opts?.required}>
          {label}
        </FieldLabel>
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
        {opts?.note ? (
          <FieldDescription
            id={`${id}-note`}
            className={cn(
              opts.note.tone === "ok" && "text-ok",
              opts.note.tone === "warn" && "text-warn"
            )}
          >
            {opts.note.text}
          </FieldDescription>
        ) : null}
      </Field>
    );
  };

  function submit(values: VendorFormValues) {
    // The disabled button is not the guard — a form still submits on Enter.
    // Only a REFUSAL stops it; a lookup we could not make never does.
    if (gstRefusal) return;

    const body = {
      name: values.name,
      gstNumber: values.gstNumber,
      // An empty box means "not recorded", which the API stores as null —
      // never an empty string. All three statutory extras behave that way.
      cin: values.cin === "" ? null : values.cin,
      pan: values.pan === "" ? null : values.pan,
      gstCompanyStatus:
        values.gstCompanyStatus === "" ? null : values.gstCompanyStatus,
      contactPerson: values.contactPerson,
      phone: values.phone,
      address: values.address,
      city: values.city,
      state: values.state,
      pincode: values.pincode,
      intakeChannels: values.intakeChannels,
      isActive: values.status === "Active",
      addressSearchEnabled: values.addressSearch === "On",
      locationCheckEnabled: values.locationCheck === "On",
    };
    const done = (saved: Vendor) => {
      // On ADD the reply is a CreatedVendor and may carry an undelivered
      // password; on edit it is a plain Vendor and never does.
      const created = saved as Partial<CreatedVendor>;
      if (created.emailStatus === "failed") {
        onUndelivered(created as CreatedVendor);
        return;
      }
      toast.add({
        title: `${saved.name} ${isEdit ? "updated" : "added"}`,
        description:
          created.emailStatus === "sent"
            ? `A temporary password has been emailed to ${values.loginEmail}.`
            : `Intake ${saved.intakeChannels.join(" + ")} · ${
                saved.isActive ? "Active" : "Paused"
              }.`,
      });
      onDone();
    };
    // The toaster still reports it — this only says WHICH box to fix.
    const onError = (err: unknown) =>
      gstConflict.capture(err, values.gstNumber, VENDOR_GST_CODES);

    if (isEdit) {
      update.mutate(
        {
          id: vendor.id,
          ...body,
        },
        { onSuccess: done, onError }
      );
    } else {
      create.mutate(
        { ...body, loginEmail: values.loginEmail },
        { onSuccess: done, onError }
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
          one place — the GST certificate, the letterhead, a phone, an envelope
          — and each row of three is one of those places.

          STATUTORY IDENTITY LEADS, and the two sections it feeds follow it. The
          GSTIN is the one value an operator actually holds at the start: it
          identifies the company, so the name, the registered address and the
          registration's standing are all answerable from it. Asking for the
          company name first and overwriting it a moment later is the wrong
          order to put a person through — the same reasoning that fixed the
          order of `shared/AddressFields` (address → pincode → city → state). */}
      <FormSection
        legend="Statutory identity"
        hint="As printed on the GST certificate. The GSTIN and CIN are stored in upper case."
      >
        <FieldGrid className={COLS}>
          {renderField("gstNumber", "GSTIN", {
            required: true,
            mono: true,
            maxLength: 15,
            placeholder: "27AAACV1234A1Z5",
            error: gstError,
            note: gstNote,
          })}
          {/* Beside the GSTIN because it IS the GSTIN: characters 3–12 of one
              are the holder's PAN, so this box never needs a lookup — only the
              slice. Same row-of-three as the company form. */}
          {renderField("pan", "PAN", {
            mono: true,
            maxLength: 10,
            placeholder: "AAACV1234A",
            hint: "The ten characters inside the GSTIN.",
          })}
          {/* Named as the superadmin's company form names the same fact about
              the tenant itself. Nobody types it from memory — it comes back
              with the GSTIN, which is why it sits beside it. */}
          {renderField("gstCompanyStatus", "GST company status", {
            placeholder: "Active",
            hint: "The registration's standing at the GST portal.",
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
        </FieldGrid>
      </FormSection>

      <FormSection legend="Company">
        <FieldGrid className={COLS}>
          {renderField("name", "Company name", {
            required: true,
            placeholder: "e.g. Reliance GreenTech Industries",
            hint: "This is the brand shown on every product model you attribute to it.",
          })}
          {renderField("contactPerson", "Contact person", {
            required: true,
            placeholder: "e.g. Rakesh Mehta",
            hint: "Who ops call about a delivery, a part or a warranty claim.",
          })}
          {renderField("phone", "Mobile number", {
            required: true,
            type: "tel",
            inputMode: "tel",
            tabular: true,
            placeholder: "98200 11001",
            hint: "10 digits. Spaces and a +91 are fine.",
          })}
        </FieldGrid>
      </FormSection>

      <FormSection legend="Registered address">
        <FieldGrid className={COLS}>
          {/* The street line takes the whole row: it is the longest value on
              the form, and the only one where a line break carries meaning. */}
          {renderField("address", "Building, street and area", {
            required: true,
            textarea: true,
            placeholder: "Reliance GreenTech House, 14th Floor\nChakala, Andheri East",
            hint: "Paste it straight off the letterhead — line breaks are kept.",
            className: "sm:col-span-2 lg:col-span-3",
          })}
          {renderField("city", "City", {
            required: true,
            placeholder: "Mumbai",
          })}
          {renderField("state", "State", {
            required: true,
            placeholder: "Maharashtra",
          })}
          {renderField("pincode", "Pincode", {
            required: true,
            inputMode: "numeric",
            tabular: true,
            maxLength: 6,
            placeholder: "400099",
          })}
        </FieldGrid>
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

      <FormSection legend="Portal access">
        {/* The email and the address search share one row of two. Both are
            answers about this vendor's portal — the address the portal is
            reached at, and what its ticket form offers — and the email alone in
            a row of three left two empty columns under a dialog this long. */}
        <FieldGrid className={PAIR}>
          {renderField("loginEmail", "Login email", {
            // Marked only while it can be typed. On edit the box is read-only —
            // the identity the account is looked up by — and an asterisk on a
            // disabled field asks for something the operator cannot give.
            required: !isEdit,
            type: "email",
            placeholder: "ops@vendor.com",
            // Read-only on edit: this is the identity the account is looked up
            // by, and moving it would strand the vendor on credentials nobody
            // recorded. The server does not accept a change either.
            readOnly: isEdit,
            hint: isEdit
              ? "The address this vendor signs in with. Use Reset password on the vendor row to email a new one."
              : "We email a temporary password here. They sign in with it and raise their own tickets.",
          })}
          {/* Here rather than beside Status, and rather than with Ticket
              intake. This section means "what this vendor's portal IS"; intake
              channels are how tickets ARRIVE, and Status is the brand's
              lifecycle. This is about the intake form itself. */}
          <Controller
            name="addressSearch"
            control={control}
            render={({ field }) => (
              <AddressSearchField
                value={field.value}
                onChange={field.onChange}
                error={errors.addressSearch?.message}
                errorId="vendor-address-search-error"
              />
            )}
          />
        </FieldGrid>
      </FormSection>

      {/* The last two booleans share a row rather than stacking full width, and
          neither keeps a section heading of its own — each `ChoiceCards` legend
          already names its question, and a heading over a single control only
          repeats it. They stay two different questions: the left one is how a
          technician's proof is verified out on site, which the vendor never
          sees; the right one is the brand's lifecycle in this console. */}
      <FieldGrid className={PAIR}>
        <Controller
          name="locationCheck"
          control={control}
          render={({ field }) => (
            <LocationCheckField
              value={field.value}
              onChange={field.onChange}
              error={errors.locationCheck?.message}
              errorId="vendor-location-check-error"
            />
          )}
        />

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
      </FieldGrid>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending || gstRefusal}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Add vendor"}
        </Button>
      </DialogFooter>
    </form>
  );
}
