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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useBrand } from "@/hooks/useBrand";
import {
  useCreateFranchisee,
  useUpdateFranchisee,
} from "@/hooks/useFranchisees";
import type { Franchisee } from "@/types/franchisee";
import { FranchiseeKindField } from "./FranchiseeKindField";
import { wireKindToWord } from "./franchiseeKind";
import {
  franchiseeSchema,
  franchiseeToInput,
  type FranchiseeFormValues,
} from "./franchiseeSchema";

interface FranchiseeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. Pass a franchisee to edit it in place. */
  franchisee?: Franchisee;
  /**
   * On add only: hands the created row to the caller, which opens step 2 —
   * the pincodes dialog — on it. Step 2 being the SAME `PUT …/pincodes` an
   * edit uses is the whole reason add cannot take ranges (Task 08 §4.1).
   */
  onCreated?: (created: Franchisee) => void;
}

/**
 * Details only, by design: a franchisee is created and THEN given pincodes, so
 * this form is step 1 of 2 and says so. On the home the kind cards lock —
 * "home" IS internal, permanently.
 *
 * Keyed remount, like `TechnicianFormDialog`: the dialog unmounts on close and
 * the key remounts the form when it is reopened against a different row, so an
 * edit never opens holding the previous franchisee's values.
 */
export function FranchiseeFormDialog({
  open,
  onOpenChange,
  franchisee,
  onCreated,
}: FranchiseeFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <FranchiseeForm
          key={franchisee?.id ?? "new"}
          franchisee={franchisee}
          onDone={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

function FranchiseeForm({
  franchisee,
  onDone,
  onCreated,
}: {
  franchisee?: Franchisee;
  onDone: () => void;
  onCreated?: (created: Franchisee) => void;
}) {
  const isEdit = franchisee !== undefined;
  const company = useBrand().name;
  const create = useCreateFranchisee();
  const update = useUpdateFranchisee();
  const pending = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FranchiseeFormValues>({
    resolver: zodResolver(franchiseeSchema),
    defaultValues: {
      name: franchisee?.name ?? "",
      kind: franchisee ? wireKindToWord(franchisee.kind) : "External",
      contactName: franchisee?.contactName ?? "",
      contactPhone: franchisee?.contactPhone ?? "",
      contactEmail: franchisee?.contactEmail ?? "",
    },
  });

  const err = (name: keyof FranchiseeFormValues) => errors[name]?.message;

  function submit(values: FranchiseeFormValues) {
    if (isEdit) {
      update.mutate(
        { id: franchisee.id, ...franchiseeToInput(values) },
        {
          onSuccess: (saved) => {
            toast.add({ title: `${saved.name} saved` });
            onDone();
          },
        }
      );
      return;
    }
    create.mutate(franchiseeToInput(values), {
      onSuccess: (created) => onCreated?.(created),
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit ${franchisee.name}` : "Add franchisee"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Changes apply straight away."
            : "Step 1 of 2 — details. You give it pincodes next."}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="mt-5">
        <Field data-invalid={err("name") ? true : undefined}>
          <FieldLabel htmlFor="franchisee-name" required>
            Name
          </FieldLabel>
          <Input
            id="franchisee-name"
            autoComplete="off"
            placeholder="e.g. SkyFix Services"
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={
              err("name") ? "franchisee-name-error" : undefined
            }
            {...register("name")}
          />
          {err("name") ? (
            <FieldDescription
              id="franchisee-name-error"
              role="alert"
              className="text-danger"
            >
              {err("name")}
            </FieldDescription>
          ) : null}
        </Field>

        {/* The form holds the WORD ("External"/"Internal"); the wire takes
            lowercase, converted once at submit inside `franchiseeToInput`. */}
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <FranchiseeKindField
              value={field.value}
              onChange={field.onChange}
              company={company}
              locked={franchisee?.isHome}
              error={err("kind")}
              errorId="franchisee-kind-error"
            />
          )}
        />

        {/* Paired: a contact is a name and a number, always filled together —
            the exact shape FieldGrid exists for (trap 5). */}
        <FieldGrid className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={err("contactName") ? true : undefined}>
            <FieldLabel htmlFor="franchisee-contact-name" required>
              Contact name
            </FieldLabel>
            <Input
              id="franchisee-contact-name"
              autoComplete="off"
              placeholder="e.g. Ravi Kumar"
              aria-invalid={err("contactName") ? true : undefined}
              aria-describedby={
                err("contactName") ? "franchisee-contact-name-error" : undefined
              }
              {...register("contactName")}
            />
            {err("contactName") ? (
              <FieldDescription
                id="franchisee-contact-name-error"
                role="alert"
                className="text-danger"
              >
                {err("contactName")}
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={err("contactPhone") ? true : undefined}>
            <FieldLabel htmlFor="franchisee-contact-phone" required>
              Contact phone
            </FieldLabel>
            <Input
              id="franchisee-contact-phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="10 digits"
              aria-invalid={err("contactPhone") ? true : undefined}
              aria-describedby={
                err("contactPhone")
                  ? "franchisee-contact-phone-error"
                  : undefined
              }
              {...register("contactPhone")}
            />
            {err("contactPhone") ? (
              <FieldDescription
                id="franchisee-contact-phone-error"
                role="alert"
                className="text-danger"
              >
                {err("contactPhone")}
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGrid>

        <Field data-invalid={err("contactEmail") ? true : undefined}>
          <FieldLabel htmlFor="franchisee-contact-email">
            Contact email
          </FieldLabel>
          <Input
            id="franchisee-contact-email"
            type="email"
            autoComplete="email"
            placeholder="Optional"
            aria-invalid={err("contactEmail") ? true : undefined}
            aria-describedby={
              err("contactEmail")
                ? "franchisee-contact-email-error"
                : "franchisee-contact-email-hint"
            }
            {...register("contactEmail")}
          />
          {err("contactEmail") ? (
            <FieldError>
              {err("contactEmail")}
            </FieldError>
          ) : (
            <FieldDescription id="franchisee-contact-email-hint">
              Optional — where copies of the reports go, when it is wanted.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter className="mt-5">
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {isEdit ? "Save changes" : "Save and add pincodes"}
        </Button>
      </DialogFooter>
    </form>
  );
}