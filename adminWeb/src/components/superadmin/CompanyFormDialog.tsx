import { useState } from "react";
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
import { toast } from "@/components/ui/toast";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
import { useCreateCompany, useUpdateCompany } from "@/hooks/useCompanies";
import { COMPANY_GST_CODES } from "@/lib/errorCodes";
import type { Company, CreatedCompany } from "@/types/company";
import {
  companyResolver,
  EMPTY_COMPANY_FORM,
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
          addressLine2: company.addressLine2 ?? "",
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

  const renderField = (
    name: keyof CompanyFormValues,
    label: string,
    opts?: {
      hint?: string;
      type?: string;
      placeholder?: string;
      autoComplete?: string;
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
    const describedBy = message
      ? `${name}-error`
      : opts?.hint
        ? `${name}-hint`
        : undefined;
    return (
      <Field data-invalid={message ? true : undefined} className={opts?.className}>
        <FieldLabel htmlFor={name}>{label}</FieldLabel>
        {(
          <Input
            id={name}
            type={opts?.type}
            placeholder={opts?.placeholder}
            autoComplete={opts?.autoComplete}
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
      </Field>
    );
  };

  function submit(values: CompanyFormValues) {
    const shared = {
      name: values.name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim() || null,
      gstNumber: values.gstNumber.trim().toUpperCase(),
      pan: values.pan.trim().toUpperCase(),
      gstCompanyStatus: values.gstCompanyStatus.trim(),
      addressLine1: values.addressLine1.trim(),
      addressLine2: values.addressLine2.trim() || null,
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

      <FormSection legend="Statutory identity">
        <FieldGroup className={COLS}>
          {renderField("gstNumber", "GSTIN", {
            placeholder: "29ABCDE1234F1Z5",
            hint: "15-character GST number.",
            error: gstConflict.messageFor(gstValue),
          })}
          {renderField("pan", "PAN", { placeholder: "ABCDE1234F" })}
          {renderField("gstCompanyStatus", "GST company status", {
            placeholder: "Active",
          })}
        </FieldGroup>
      </FormSection>

      <FormSection legend="Registered address">
        <FieldGroup className={COLS}>
          {/* The street line gets two of the three columns: it is the longest
              value on the form and the one most likely to be truncated. */}
          {renderField("addressLine1", "Address line 1", {
            placeholder: "Building, street",
            autoComplete: "address-line1",
            className: "sm:col-span-2",
          })}
          {renderField("addressLine2", "Address line 2", {
            placeholder: "Area, landmark (optional)",
            autoComplete: "address-line2",
          })}
          {renderField("city", "City", { autoComplete: "address-level2" })}
          {renderField("state", "State", { autoComplete: "address-level1" })}
          {renderField("pincode", "PIN code", {
            placeholder: "560001",
            autoComplete: "postal-code",
          })}
        </FieldGroup>
      </FormSection>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Create company"}
        </Button>
      </DialogFooter>
    </form>
  );
}
