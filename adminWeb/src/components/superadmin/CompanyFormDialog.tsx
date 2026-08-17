import { useForm } from "react-hook-form";
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
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useCreateCompany, useUpdateCompany } from "@/hooks/useCompanies";
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
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-2xl">
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
    handleSubmit,
    formState: { errors },
  } = useForm<CompanyFormValues>({
    resolver: companyResolver(isEdit ? "edit" : "create"),
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
          password: "",
        }
      : EMPTY_COMPANY_FORM,
  });

  const isSubmitting = create.isPending || update.isPending;

  const renderField = (
    name: keyof CompanyFormValues,
    label: string,
    opts?: {
      hint?: string;
      type?: string;
      placeholder?: string;
      autoComplete?: string;
      password?: boolean;
    }
  ) => {
    const message = errors[name]?.message;
    const describedBy = message
      ? `${name}-error`
      : opts?.hint
        ? `${name}-hint`
        : undefined;
    return (
      <Field data-invalid={message ? true : undefined}>
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

      <FieldSet>
        <FieldLegend variant="label" className="text-sm font-semibold">
          Company
        </FieldLegend>
        <FieldGroup className="gap-4">
          {renderField("name", "Company name", {
            placeholder: "Acme Installations Pvt Ltd",
            autoComplete: "organization",
          })}
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        </FieldGroup>
      </FieldSet>

      {isEdit ? null : (
        <FieldSet>
          <FieldLegend variant="label" className="text-sm font-semibold">
            Admin login
          </FieldLegend>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {renderField("adminName", "Admin name", {
                placeholder: "Full name",
                autoComplete: "name",
              })}
              {renderField("password", "Temporary password", {
                password: true,
                placeholder: "At least 8 characters",
                autoComplete: "new-password",
              })}
            </div>
          </FieldGroup>
        </FieldSet>
      )}

      <FieldSet>
        <FieldLegend variant="label" className="text-sm font-semibold">
          Statutory identity
        </FieldLegend>
        <FieldGroup className="gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {renderField("gstNumber", "GSTIN", {
              placeholder: "29ABCDE1234F1Z5",
              hint: "15-character GST number.",
            })}
            {renderField("pan", "PAN", { placeholder: "ABCDE1234F" })}
          </div>
          {renderField("gstCompanyStatus", "GST company status", {
            placeholder: "Active",
          })}
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label" className="text-sm font-semibold">
          Registered address
        </FieldLegend>
        <FieldGroup className="gap-4">
          {renderField("addressLine1", "Address line 1", {
            placeholder: "Building, street",
            autoComplete: "address-line1",
          })}
          {renderField("addressLine2", "Address line 2", {
            placeholder: "Area, landmark (optional)",
            autoComplete: "address-line2",
          })}
          <div className="grid gap-4 sm:grid-cols-3">
            {renderField("city", "City", { autoComplete: "address-level2" })}
            {renderField("state", "State", { autoComplete: "address-level1" })}
            {renderField("pincode", "PIN code", {
              placeholder: "560001",
              autoComplete: "postal-code",
            })}
          </div>
        </FieldGroup>
      </FieldSet>

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
