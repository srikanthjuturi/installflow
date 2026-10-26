import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChoiceCards } from "@/components/shared/ChoiceCards";
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
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useCreateFacilityUser } from "@/hooks/useFacilityUsers";
import type { FacilityUserSource } from "@/services/facilityUsers";
import type { CreatedFacilityUser, FacilityRole } from "@/types/parts";
import {
  ROLE_DESCRIPTION,
  ROLE_WIRE_TO_WORD,
  ROLE_WORD_TO_WIRE,
  facilityUserSchema,
  type FacilityRoleWord,
  type FacilityUserFormValues,
} from "./facilityRoles";

/**
 * Add somebody who runs the parts store — Task 13 §5.7.
 *
 * A fork of `AddFranchiseeAdminDialog` / `AddVendorUserDialog` (their reasons
 * apply unchanged: a role select with a territory is half of `AddUserDialog`,
 * and a prop that deletes half a form is harder to read than a second form).
 * The only addition is the **Role**, two cards because a role here is a choice
 * between two named things, never a switch (adminWeb AGENTS).
 *
 * `roles` is what THIS viewer may create (`rolesViewerCanAdd`): both for a
 * franchisee admin and for the company's Admin / National Head on the home
 * franchisee, only *Facility Operator* for a facility admin. With one option
 * the card fills itself — hard rule 10, `useAutoSelectSingle`.
 *
 * `source` picks the door (the portal's own, or the staff console's home one);
 * the form and the replies are the same.
 */
export function AddFacilityUserDialog({
  open,
  onOpenChange,
  source,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: FacilityUserSource;
  roles: FacilityRole[];
}) {
  // Set when the password email did not go out — the dialog then shows the
  // password instead of the form. See TemporaryPasswordPanel for why not a toast.
  const [undelivered, setUndelivered] = useState<CreatedFacilityUser | null>(null);

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
          <AddFacilityUserForm
            source={source}
            roles={roles}
            onDone={close}
            onUndelivered={setUndelivered}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddFacilityUserForm({
  source,
  roles,
  onDone,
  onUndelivered,
}: {
  source: FacilityUserSource;
  roles: FacilityRole[];
  onDone: () => void;
  onUndelivered: (user: CreatedFacilityUser) => void;
}) {
  const create = useCreateFacilityUser(source);
  const options: FacilityRoleWord[] = roles.map((r) => ROLE_WIRE_TO_WORD[r]);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FacilityUserFormValues>({
    resolver: zodResolver(facilityUserSchema),
    mode: "onChange",
    defaultValues: { fullName: "", email: "", phone: "" },
  });

  const submit = async (values: FacilityUserFormValues) => {
    try {
      const created = await create.mutateAsync({
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        role: ROLE_WORD_TO_WIRE[values.role],
      });
      // The account exists in every case — the server answers 201 even when the
      // email failed. Only what to say differs.
      if (created.emailStatus === "failed") {
        onUndelivered(created);
        return;
      }
      toast.add({
        title: `${values.fullName} added`,
        description: "We emailed their temporary password.",
      });
      onDone();
    } catch {
      // Reported in the toaster by the global mutation handler.
    }
  };

  const err = (name: keyof FacilityUserFormValues) => errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <DialogHeader>
        <DialogTitle>Add facility user</DialogTitle>
        <DialogDescription>
          They get an email with a temporary password and see only spare-part
          requests.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="mt-5">
        <Field data-invalid={err("fullName") ? true : undefined}>
          <FieldLabel htmlFor="fu-name" required>
            Full name
          </FieldLabel>
          <Input
            id="fu-name"
            autoComplete="off"
            aria-invalid={err("fullName") ? true : undefined}
            aria-describedby={err("fullName") ? "fu-name-error" : undefined}
            {...register("fullName")}
          />
          {err("fullName") ? (
            <FieldDescription id="fu-name-error" role="alert" className="text-danger">
              {err("fullName")}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={err("email") ? true : undefined}>
          <FieldLabel htmlFor="fu-email" required>
            Email
          </FieldLabel>
          <Input
            id="fu-email"
            type="email"
            autoComplete="off"
            aria-invalid={err("email") ? true : undefined}
            aria-describedby={err("email") ? "fu-email-error" : undefined}
            {...register("email")}
          />
          {err("email") ? (
            <FieldDescription id="fu-email-error" role="alert" className="text-danger">
              {err("email")}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={err("phone") ? true : undefined}>
          <FieldLabel htmlFor="fu-phone" required>
            Phone
          </FieldLabel>
          <Input
            id="fu-phone"
            type="tel"
            autoComplete="off"
            aria-invalid={err("phone") ? true : undefined}
            aria-describedby={err("phone") ? "fu-phone-error" : undefined}
            {...register("phone")}
          />
          {err("phone") ? (
            <FieldDescription id="fu-phone-error" role="alert" className="text-danger">
              {err("phone")}
            </FieldDescription>
          ) : null}
        </Field>

        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <RoleField
              options={options}
              value={field.value}
              onChange={(next) =>
                setValue("role", next, { shouldValidate: true })
              }
              error={err("role")}
            />
          )}
        />
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

/**
 * The role cards. Its own component so `useAutoSelectSingle` (a hook) sits at a
 * component's top level; with a single option it picks that one and the cards
 * show it already chosen.
 */
function RoleField({
  options,
  value,
  onChange,
  error,
}: {
  options: FacilityRoleWord[];
  value: FacilityRoleWord | undefined;
  onChange: (value: FacilityRoleWord) => void;
  error?: string;
}) {
  useAutoSelectSingle(options, value, onChange);

  return (
    <ChoiceCards
      legend="Role"
      options={options}
      // RadioGroup shows nothing chosen for "" — the empty state before a pick.
      value={(value ?? "") as FacilityRoleWord}
      onChange={onChange}
      descriptions={Object.fromEntries(
        options.map((o) => [o, ROLE_DESCRIPTION[o]])
      )}
      error={error}
      errorId="fu-role-error"
    />
  );
}
