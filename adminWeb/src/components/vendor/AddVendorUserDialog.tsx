import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { toast } from "@/components/ui/toast";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
import { useCreateVendorUser } from "@/hooks/useVendorUsers";
import type { CreatedVendorUser } from "@/types/vendorUser";
import {
  EMPTY_VENDOR_USER,
  vendorUserSchema,
  type VendorUserValues,
} from "./vendorUserSchema";

/**
 * Add somebody who can raise tickets for this vendor.
 *
 * A fork of `AddUserDialog` rather than a `mode` prop on it: the role select,
 * the assignable-role lookup and the whole `ScopeField` come out, which is
 * nearly half of that component. A prop that deletes half a form is harder to
 * read than two forms.
 */
export function AddVendorUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Set when the password email did not go out — the dialog then shows the
  // password instead of the form. See TemporaryPasswordPanel for why not a toast.
  const [undelivered, setUndelivered] = useState<CreatedVendorUser | null>(null);

  function close() {
    onOpenChange(false);
    setTimeout(() => setUndelivered(null), 200);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      {/* Unmounts on close, so a second open never holds the first attempt. */}
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-lg">
        {undelivered ? (
          <TemporaryPasswordPanel
            heading="Added, but the email didn't send"
            email={undelivered.email ?? ""}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          <AddVendorUserForm onDone={close} onUndelivered={setUndelivered} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddVendorUserForm({
  onDone,
  onUndelivered,
}: {
  onDone: () => void;
  onUndelivered: (user: CreatedVendorUser) => void;
}) {
  const create = useCreateVendorUser();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VendorUserValues>({
    resolver: zodResolver(vendorUserSchema),
    mode: "onChange",
    defaultValues: EMPTY_VENDOR_USER,
  });

  const submit = async (values: VendorUserValues) => {
    try {
      const created = await create.mutateAsync({
        fullName: values.fullName,
        email: values.email,
        phone: values.phone || null,
      });
      // The account exists in every case — the server answers 201 even when the
      // email failed. Only what to say differs.
      if (created.emailStatus === "failed") {
        onUndelivered(created);
        return;
      }
      toast.add({
        title: `${values.fullName} added`,
        description:
          created.emailStatus === "skipped"
            ? "They sign in with the password they already use."
            : `A temporary password has been emailed to ${values.email}.`,
      });
      onDone();
    } catch {
      // Reported in the toaster by the global mutation handler.
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <DialogHeader>
        <DialogTitle>Add a user</DialogTitle>
        <DialogDescription>
          They can raise tickets and follow the ones they raise.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="mt-5">
        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="vu-name" required>
            Full name
          </FieldLabel>
          <Input
            id="vu-name"
            autoComplete="off"
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={errors.fullName ? "vu-name-error" : undefined}
            {...register("fullName")}
          />
          {errors.fullName ? (
            <FieldDescription id="vu-name-error" role="alert" className="text-danger">
              {errors.fullName.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="vu-email" required>
            Email
          </FieldLabel>
          <Input
            id="vu-email"
            type="email"
            autoComplete="off"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "vu-email-error" : "vu-email-hint"}
            {...register("email")}
          />
          {errors.email ? (
            <FieldDescription id="vu-email-error" role="alert" className="text-danger">
              {errors.email.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="vu-email-hint">
              What they sign in with.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="vu-phone">Phone (optional)</FieldLabel>
          <Input
            id="vu-phone"
            type="tel"
            autoComplete="off"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "vu-phone-error" : undefined}
            {...register("phone")}
          />
          {errors.phone ? (
            <FieldDescription id="vu-phone-error" role="alert" className="text-danger">
              {errors.phone.message}
            </FieldDescription>
          ) : null}
        </Field>

      </FieldGroup>

      <DialogFooter className="mt-6">
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          Add user
        </Button>
      </DialogFooter>
    </form>
  );
}
