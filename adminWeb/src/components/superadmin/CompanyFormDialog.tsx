import { useForm, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useCreateCompany, useUpdateCompany } from "@/hooks/useCompanies";
import { suggestCompanyCode } from "@/services/companies";
import type { Company } from "@/types/company";
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {/* Remounts on open so the form is always clean; the key also covers
            reopening on a different row. */}
        <CompanyForm
          key={company?.id ?? "new"}
          company={company}
          onDone={() => onOpenChange(false)}
        />
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
}: {
  company?: Company;
  onDone: () => void;
}) {
  const isEdit = Boolean(company);
  const create = useCreateCompany();
  const update = useUpdateCompany();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CompanyFormValues>({
    resolver: companyResolver(isEdit ? "edit" : "create"),
    // Surface validation errors as the user types, not only on submit.
    mode: "onChange",
    defaultValues: company
      ? {
          name: company.name,
          code: company.code,
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
          password: "",
        }
      : EMPTY_COMPANY_FORM,
  });

  const isSubmitting = create.isPending || update.isPending;

  /**
   * What the server would call this company, asked of the server.
   *
   * The console deliberately does not derive the code itself. Two copies of one
   * rule disagree eventually, and the disagreement would surface as a
   * superadmin watching the code they were shown not be the code they got.
   *
   * Only while creating: an existing company's code is fixed, so a suggestion
   * for it would be an invitation to change something that cannot change.
   */
  const watchedName = useWatch({ control, name: "name" });
  const trimmedName = (watchedName ?? "").trim();
  const { data: suggestion } = useQuery({
    queryKey: ["company-code-suggestion", trimmedName],
    queryFn: () => suggestCompanyCode(trimmedName),
    // No `open` guard: this body only mounts while the dialog is open.
    enabled: !isEdit && trimmedName.length > 1,
    staleTime: 60_000,
  });

  const codeSuggestion = isEdit ? null : (suggestion?.code ?? null);
  const codeHint = !codeSuggestion
    ? "Leave blank to use the initials of the name."
    : suggestion?.exact
      ? `Blank uses ${codeSuggestion}. Every code starts with it: ${codeSuggestion}-INST-0001.`
      : `Blank uses ${codeSuggestion} — the natural code is already taken.`;

  const renderField = (
    name: keyof CompanyFormValues,
    label: string,
    opts?: {
      hint?: string;
      type?: string;
      placeholder?: string;
      autoComplete?: string;
      password?: boolean;
      /** Column span inside the three-column grid — for the one or two fields
       *  that genuinely need the room, like a street address. */
      className?: string;
    }
  ) => {
    const message = errors[name]?.message;
    const describedBy = message
      ? `${name}-error`
      : opts?.hint
        ? `${name}-hint`
        : undefined;
    return (
      <Field data-invalid={message ? true : undefined} className={opts?.className}>
        <FieldLabel htmlFor={name}>{label}</FieldLabel>
        {opts?.password ? (
          <PasswordInput
            id={name}
            placeholder={opts?.placeholder}
            autoComplete={opts?.autoComplete}
            aria-invalid={message ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        ) : (
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
        }
      );
      return;
    }

    create.mutate(
      {
        ...shared,
        // Blank means "derive it" — the server owns that rule, so an untouched
        // field must not be sent as an empty string it would have to interpret.
        code: values.code.trim().toUpperCase() || undefined,
        password: values.password,
        adminName: values.adminName.trim() || null,
      },
      {
        onSuccess: (saved) => {
          toast.add({
            title: `${saved.name} created`,
            description: `${saved.adminEmail ?? saved.email} can now sign in as its admin.`,
          });
          onDone();
        },
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
            : "Create a company and its first admin. The admin signs in with the email and password below."}
        </DialogDescription>
      </DialogHeader>

      <FormSection legend="Company">
        <FieldGroup className={COLS}>
          {renderField("name", "Company name", {
            placeholder: "Acme Installations Pvt Ltd",
            autoComplete: "organization",
          })}
          {renderField("code", "Code", {
            placeholder: codeSuggestion ?? "RGT",
            hint: isEdit
              ? "Fixed once created — every code already issued starts with it."
              : codeHint,
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
            {renderField("password", "Temporary password", {
              password: true,
              placeholder: "At least 8 characters",
              autoComplete: "new-password",
            })}
          </FieldGroup>
        </FormSection>
      )}

      <FormSection legend="Statutory identity">
        <FieldGroup className={COLS}>
          {renderField("gstNumber", "GSTIN", {
            placeholder: "29ABCDE1234F1Z5",
            hint: "15-character GST number.",
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
