import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TemporaryPasswordPanel } from "@/components/shared/TemporaryPasswordPanel";
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
import { useAddFranchiseeAdmin } from "@/hooks/useFranchisees";
import type { CreatedFranchiseeAdmin, Franchisee } from "@/types/franchisee";
import { adminSchema, type AdminFormValues } from "./franchiseeSchema";

/**
 * Add a login for this franchisee.
 *
 * The console's own phone rule applies to this form exactly as to every other
 * console login (`root` AGENTS): a mandatory mobile is the only way to reach
 * somebody whose mailbox — the thing they SIGN IN with — has gone wrong.
 *
 * A fork of `AddVendorUserDialog`, and for the same reason that one is a fork of
 * `AddUserDialog`: the role select and territory scoping come out whole. The
 * role is decided for the caller — the server stamps `franchisee_admin` on this
 * endpoint.
 */
export function AddFranchiseeAdminDialog({
  open,
  onOpenChange,
  franchisee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  franchisee: Franchisee;
}) {
  // Set when the password email did not go out — the dialog then shows the
  // password instead of the form. See TemporaryPasswordPanel for why not a toast.
  const [undelivered, setUndelivered] = useState<CreatedFranchiseeAdmin | null>(
    null
  );

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
            heading="Admin added, but the email didn't send"
            email={undelivered.email ?? ""}
            password={undelivered.temporaryPassword ?? ""}
            reason={undelivered.emailError}
            onDone={close}
          />
        ) : (
          <AddAdminForm
            franchisee={franchisee}
            onDone={close}
            onUndelivered={setUndelivered}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddAdminForm({
  franchisee,
  onDone,
  onUndelivered,
}: {
  franchisee: Franchisee;
  onDone: () => void;
  onUndelivered: (admin: CreatedFranchiseeAdmin) => void;
}) {
  const create = useAddFranchiseeAdmin();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminFormValues>({
    resolver: zodResolver(adminSchema),
    mode: "onChange",
    defaultValues: { fullName: "", email: "", phone: "" },
  });

  const submit = async (values: AdminFormValues) => {
    try {
      const created = await create.mutateAsync({
        franchiseeId: franchisee.id,
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
      });
      // The account exists in every case — the server answers 201 even when
      // the email failed. Only what to say differs.
      if (created.emailStatus === "failed") {
        onUndelivered(created);
        return;
      }
      toast.add({
        title: `${created.email} added`,
        description: "A temporary password is on its way to them.",
      });
      onDone();
    } catch {
      // Reported in the toaster by the global mutation handler.
    }
  };

  const err = (name: keyof AdminFormValues) => errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <DialogHeader>
        <DialogTitle>Add a franchisee admin</DialogTitle>
        <DialogDescription>
          They get an email with a temporary password and sign in to the
          franchise portal for {franchisee.name}.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="mt-5">
        <Field data-invalid={err("fullName") ? true : undefined}>
          <FieldLabel htmlFor="fa-name" required>
            Full name
          </FieldLabel>
          <Input
            id="fa-name"
            autoComplete="off"
            aria-invalid={err("fullName") ? true : undefined}
            aria-describedby={err("fullName") ? "fa-name-error" : undefined}
            {...register("fullName")}
          />
          {err("fullName") ? (
            <FieldDescription id="fa-name-error" role="alert" className="text-danger">
              {err("fullName")}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={err("email") ? true : undefined}>
          <FieldLabel htmlFor="fa-email" required>
            Email
          </FieldLabel>
          <Input
            id="fa-email"
            type="email"
            autoComplete="off"
            aria-invalid={err("email") ? true : undefined}
            aria-describedby={err("email") ? "fa-email-error" : "fa-email-hint"}
            {...register("email")}
          />
          {err("email") ? (
            <FieldDescription id="fa-email-error" role="alert" className="text-danger">
              {err("email")}
            </FieldDescription>
          ) : (
            <FieldDescription id="fa-email-hint">
              What they sign in with.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={err("phone") ? true : undefined}>
          <FieldLabel htmlFor="fa-phone" required>
            Mobile number
          </FieldLabel>
          <Input
            id="fa-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="10 digits"
            aria-invalid={err("phone") ? true : undefined}
            aria-describedby={err("phone") ? "fa-phone-error" : undefined}
            {...register("phone")}
          />
          {err("phone") ? (
            <FieldDescription id="fa-phone-error" role="alert" className="text-danger">
              {err("phone")}
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
          Add admin
        </Button>
      </DialogFooter>
    </form>
  );
}