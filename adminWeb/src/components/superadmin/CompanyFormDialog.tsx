import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { FormSection } from "@/components/shared/FormSection";
import { useFieldConflict } from "@/components/shared/useFieldConflict";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
import { useCreateCompany, useUpdateCompany } from "@/hooks/useCompanies";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useGstinLookup } from "@/hooks/useGstinLookup";
import { COMPANY_GST_CODES } from "@/lib/errorCodes";
import { cn } from "@/lib/utils";
import type { Company, CreatedCompany } from "@/types/company";
import {
  companyResolver,
  EMPTY_COMPANY_FORM,
  GSTIN_RE,
  type CompanyFormValues,
} from "./companySchema";

interface CompanyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit that company. Absent → create a new one. */
  company?: Company;
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
}: CompanyFormDialogProps) {
  // Set when the admin's password email did not go out — the dialog then shows
  // the password instead of the form. See TemporaryPasswordPanel for why this
  // cannot be a toast.
  const [undelivered, setUndelivered] = useState<CreatedCompany | null>(null);

  function close() {
    onOpenChange(false);
    setTimeout(() => setUndelivered(null), 200);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {undelivered ? (
          <TemporaryPasswordPanel
            heading="Created, but the email didn't send"
            email={undelivered.adminEmail ?? undelivered.email}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          /* Remounts on open so the form is always clean; the key also covers
             reopening on a different row. */
          <CompanyForm
            key={company?.id ?? "new"}
            company={company}
            onDone={close}
            onUndelivered={setUndelivered}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The field grid every section uses.
 *
 * One column on a phone, two on a tablet, three from `lg` up — a static string,
 * because an interpolated `grid-cols-${n}` is never generated and the row would
 * silently collapse to one column.
 */
const COLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

function CompanyForm({
  company,
  onDone,
  onUndelivered,
}: {
  company?: Company;
  onDone: () => void;
  onUndelivered: (created: CreatedCompany) => void;
}) {
  const isEdit = Boolean(company);
  const create = useCreateCompany();
  const update = useUpdateCompany();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<CompanyFormValues>({
    resolver: companyResolver(),
    // Surface validation errors as the user types, not only on submit.
    mode: "onChange",
    defaultValues: company
      ? {
          name: company.name,
          email: company.email,
          phone: company.phone ?? "",
          gstNumber: company.gstNumber,
          pan: company.pan,
          gstCompanyStatus: company.gstCompanyStatus,
          addressLine1: company.addressLine1,
          city: company.city,
          state: company.state,
          pincode: company.pincode,
          adminName: "",
        }
      : EMPTY_COMPANY_FORM,
  });

  const isSubmitting = create.isPending || update.isPending;

  // Two GSTIN clashes only the server can see: another company already has it,
  // or one of THIS company's own vendors does. Both are 409s that belong on the
  // GSTIN box. `mode: "onChange"` is exactly why they cannot live in RHF —
  // see useFieldConflict.
  const gstConflict = useFieldConflict();
  const gstValue = useWatch({ control, name: "gstNumber" });

  /*
   * ── Autofill from the GST registry ──────────────────────────────────────
   *
   * The superadmin twin of the vendor dialog's, and deliberately identical in
   * behaviour: gated on a COMPLETE GSTIN so no partial value is ever asked
   * about, debounced so pasting and typing both cost one call, and cached by
   * the hook so the same number is never bought twice.
   *
   * It calls `/companies/gstin-lookup` rather than the vendors route only
   * because a superadmin holds no membership and no company feature.
   */
  const gstin = (gstValue ?? "").trim().toUpperCase();
  const debouncedGstin = useDebouncedValue(gstin, 400);
  const gstinComplete = GSTIN_RE.test(debouncedGstin);
  const gstLookup = useGstinLookup(debouncedGstin, gstinComplete, "company");

  /** The GSTIN already filled from — without it this fights the user's typing. */
  const filledFrom = useRef<string | null>(null);

  useEffect(() => {
    const found = gstLookup.data;
    if (!found || found.outcome !== "found") return;
    if (filledFrom.current === debouncedGstin) return;
    filledFrom.current = debouncedGstin;

    /*
     * CREATING fills everything. EDITING fills only what is empty — a saved
     * company's details may have been corrected by hand, and an address
     * deliberately different from the registered one is an ordinary thing.
     * What the registry says is shown under the GSTIN instead, where a
     * disagreement is visible and nothing is destroyed to make it so.
     */
    const fill = (
      name:
        | "name"
        | "pan"
        | "gstCompanyStatus"
        | "addressLine1"
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
    fill("addressLine1", found.address);
    fill("city", found.city);
    fill("state", found.state);
    fill("pincode", found.pincode);
  }, [gstLookup.data, debouncedGstin, isEdit, getValues, setValue]);

  /** A real answer about the GSTIN: it is not registered. Blocks the save. */
  const gstNotRegistered =
    gstinComplete && gstLookup.data?.outcome === "not_registered";

  /**
   * We could not ask — our subscription, or the portal. **Blocks nothing.**
   * A failed request and a 200 saying `unavailable` are one thing to the
   * person filling the form in.
   */
  const gstUnavailable =
    gstinComplete &&
    (gstLookup.isError || gstLookup.data?.outcome === "unavailable");

  /** The line under the GSTIN: what the registry said, or why it did not. */
  const gstNote = (() => {
    if (!gstinComplete) return null;
    if (gstLookup.isFetching)
      return { tone: "muted" as const, text: "Checking with the GST portal…" };
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

  const renderField = (
    name: keyof CompanyFormValues,
    label: string,
    opts?: {
      hint?: string;
      type?: string;
      placeholder?: string;
      autoComplete?: string;
      /** Render as a textarea, keeping the line breaks — the street address. */
      textarea?: boolean;
      rows?: number;
      /** A statutory identifier: mono and wide-tracked, so a transposed
       *  character is visible rather than lost in a run of caps. */
      mono?: boolean;
      maxLength?: number;
      /** A line that is NOT a rejection: what the registry found, or why it
       *  could not be asked. Carries its own tone, so "we could not check"
       *  never reads like "this is wrong". */
      note?: { text: string; tone: "muted" | "ok" | "warn" } | null;
      /** Column span inside the three-column grid — for the one or two fields
       *  that genuinely need the room, like a street address. */
      className?: string;
      /** A rejection the schema could not have known about — a server 409.
       *  Zod wins if both are present: a malformed value is the nearer
       *  problem, and the stale conflict clears as soon as it is fixed. */
      error?: string;
    }
  ) => {
    const message = errors[name]?.message ?? opts?.error;
    const describedBy =
      [
        message ? `${name}-error` : opts?.hint ? `${name}-hint` : null,
        opts?.note ? `${name}-note` : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <Field data-invalid={message ? true : undefined} className={opts?.className}>
        <FieldLabel htmlFor={name}>{label}</FieldLabel>
        {opts?.textarea ? (
          <Textarea
            id={name}
            rows={opts.rows ?? 2}
            className="resize-y"
            placeholder={opts.placeholder}
            aria-invalid={message ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        ) : (
          <Input
            id={name}
            type={opts?.type}
            maxLength={opts?.maxLength}
            placeholder={opts?.placeholder}
            autoComplete={opts?.autoComplete}
            autoCapitalize={opts?.mono ? "characters" : undefined}
            spellCheck={opts?.mono ? false : undefined}
            className={cn(opts?.mono && "font-mono tracking-wide uppercase")}
            aria-invalid={message ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        )}
        {opts?.hint && !message ? (
          <FieldDescription id={`${name}-hint`}>{opts.hint}</FieldDescription>
        ) : null}
        {message ? (
          <FieldDescription
            id={`${name}-error`}
            role="alert"
            className="text-danger"
          >
            {message}
          </FieldDescription>
        ) : null}
        {opts?.note ? (
          <FieldDescription
            id={`${name}-note`}
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

  function submit(values: CompanyFormValues) {
    // The disabled button is not the guard — a form still submits on Enter.
    // Only a REFUSAL stops it; a lookup we could not make never does.
    if (gstNotRegistered) return;

    const shared = {
      name: values.name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim() || null,
      gstNumber: values.gstNumber.trim().toUpperCase(),
      pan: values.pan.trim().toUpperCase(),
      gstCompanyStatus: values.gstCompanyStatus.trim(),
      addressLine1: values.addressLine1.trim(),
      city: values.city.trim(),
      state: values.state.trim(),
      pincode: values.pincode.trim(),
    };
    // The toaster still reports it — this only says WHICH box to fix.
    const onError = (err: unknown) =>
      gstConflict.capture(err, shared.gstNumber, COMPANY_GST_CODES);

    if (company) {
      // `code` is deliberately absent here. It is create-only on the API too —
      // every ticket already carries the assembled string, so a company that
      // changed its prefix would have two spellings of itself in circulation.
      update.mutate(
        { id: company.id, input: shared },
        {
          onSuccess: (saved) => {
            toast.add({ title: `${saved.name} updated` });
            onDone();
          },
          onError,
        }
      );
      return;
    }

    create.mutate(
      {
        ...shared,
        adminName: values.adminName.trim() || null,
      },
      {
        onSuccess: (saved) => {
          // The company exists in every case — the server answers 201 even when
          // the admin's password email failed. Only what to say differs.
          if (saved.emailStatus === "failed") {
            onUndelivered(saved);
            return;
          }
          toast.add({
            title: `${saved.name} created`,
            description:
              saved.emailStatus === "skipped"
                ? `${saved.adminEmail ?? saved.email} signs in as its admin with the password they already use.`
                : `A temporary password has been emailed to ${saved.adminEmail ?? saved.email}.`,
          });
          onDone();
        },
        onError,
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${company?.name}` : "Add company"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update this company's profile and statutory details."
            : "Create a company and its first admin. We email the admin a temporary password to sign in with."}
        </DialogDescription>
      </DialogHeader>

      {/* STATUTORY IDENTITY LEADS, and the two sections it feeds follow it —
          the same order the vendor dialog uses, and for the same reason. The
          GSTIN identifies the company, so its name, its PAN, its registration's
          standing and its registered address are all answerable from it.
          Asking for the name first and overwriting it a moment later is the
          wrong order to put a person through.

          The admin's details come last: they are the one thing on this form
          that no registry can answer. */}
      <FormSection
        legend="Statutory identity"
        hint="As printed on the GST certificate."
      >
        <FieldGroup className={COLS}>
          {renderField("gstNumber", "GSTIN", {
            mono: true,
            maxLength: 15,
            placeholder: "29ABCDE1234F1Z5",
            hint: "15-character GST number.",
            // An unregistered number comes first: "already registered" would
            // be a strange thing to say about a GSTIN that does not exist.
            error: gstNotRegistered
              ? (gstLookup.data?.reason ?? "That GSTIN is not registered")
              : gstConflict.messageFor(gstValue),
            note: gstNote,
          })}
          {renderField("pan", "PAN", {
            mono: true,
            maxLength: 10,
            placeholder: "ABCDE1234F",
            hint: "The ten characters inside the GSTIN.",
          })}
          {renderField("gstCompanyStatus", "GST company status", {
            placeholder: "Active",
            hint: "The registration's standing at the GST portal.",
          })}
        </FieldGroup>
      </FormSection>

      <FormSection legend="Company">
        <FieldGroup className={COLS}>
          {renderField("name", "Company name", {
            placeholder: "Acme Installations Pvt Ltd",
            autoComplete: "organization",
          })}
          {renderField("email", "Contact / admin email", {
            type: "email",
            placeholder: "admin@acme.com",
            autoComplete: "email",
            hint: isEdit ? undefined : "Becomes the admin's login email.",
          })}
          {renderField("phone", "Phone", {
            placeholder: "+91 90000 00000",
            autoComplete: "tel",
          })}
        </FieldGroup>
      </FormSection>

      <FormSection legend="Registered address">
        <FieldGroup className={COLS}>
          {/* The street line takes the whole row, as a textarea — the same
              control the vendor form uses, and for the same reasons: it is the
              longest value here, and a line break in a pasted letterhead
              address carries meaning. Line 2 is gone; this box holds both. */}
          {renderField("addressLine1", "Building, street and area", {
            textarea: true,
            placeholder: "Acme House, 14th Floor\nChakala, Andheri East",
            className: "sm:col-span-2 lg:col-span-3",
          })}
          {renderField("city", "City", { autoComplete: "address-level2" })}
          {renderField("state", "State", { autoComplete: "address-level1" })}
          {renderField("pincode", "PIN code", {
            placeholder: "560001",
            autoComplete: "postal-code",
          })}
        </FieldGroup>
      </FormSection>

      {isEdit ? null : (
        <FormSection legend="Admin login">
          <FieldGroup className={COLS}>
            {renderField("adminName", "Admin name", {
              placeholder: "Full name",
              autoComplete: "name",
            })}
          </FieldGroup>
        </FormSection>
      )}

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting || gstNotRegistered}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Create company"}
        </Button>
      </DialogFooter>
    </form>
  );
}
