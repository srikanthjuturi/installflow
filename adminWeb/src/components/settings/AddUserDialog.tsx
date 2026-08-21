import { Controller, useForm, useWatch } from "react-hook-form";
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
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { FormSection } from "@/components/shared/FormSection";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useAssignableRoles, useCreateUser } from "@/hooks/useCompanyUsers";
import { ScopeField } from "./ScopeField";
import {
  createUserResolver,
  EMPTY_INVITE,
  roleHasTerritory,
  type CreateUserValues,
} from "./companyUserSchema";

/**
 * The field grid every section uses. Two columns from `sm` up, written as a
 * static string — an interpolated `grid-cols-${n}` is never generated and the
 * row would silently collapse to one column.
 */
const COLS = "grid gap-4 sm:grid-cols-2";

export function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sized and sectioned like the vendor and company dialogs. Two columns
          rather than three: this form has six fields, and a third column would
          leave a ragged empty cell in every row.

          The popup itself scrolls, as those dialogs do, so the scrollbar sits
          on the popup wall rather than in a gutter inside it. */}
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <AddUserForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddUserForm({ onDone }: { onDone: () => void }) {
  const roles = useAssignableRoles();
  const create = useCreateUser();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<CreateUserValues>({
    resolver: createUserResolver(roles.map((r) => r.key)),
    mode: "onChange",
    defaultValues: EMPTY_INVITE,
  });

  const err = (name: keyof CreateUserValues) => errors[name]?.message;

  // The role decides what a territory even is, so these three drive the scope
  // field; a stale pick must not survive a role change (cleared on select).
  const role = useWatch({ control, name: "role" });
  const regionIds = useWatch({ control, name: "regionIds" });
  const stateIds = useWatch({ control, name: "stateIds" });

  // One assignable role (e.g. an RSH who can only appoint an ASM) fills itself.
  useAutoSelectSingle(
    roles.map((r) => r.key),
    role,
    (key) => setValue("role", key, { shouldValidate: true })
  );

  function submit(values: CreateUserValues) {
    create.mutate(
      {
        email: values.email.trim(),
        role: values.role,
        fullName: values.fullName.trim(),
        phone: values.phone.trim() || null,
        password: values.password,
        regionIds: values.regionIds,
        stateIds: values.stateIds,
      },
      {
        onSuccess: (u) => {
          toast.add({
            title: `${u.fullName ?? u.email} added`,
            description: `Role: ${u.roleLabel}. Share the temporary password so they can sign in.`,
          });
          onDone();
        },
      }
    );
  }

  return (
<form onSubmit={handleSubmit(submit)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Invite user</DialogTitle>
        <DialogDescription>
          Add a user to your company with a temporary password. You can only
          assign roles below your own.
        </DialogDescription>
      </DialogHeader>

      <FormSection legend="Person">
        <FieldGroup className={COLS}>
          {/* Spans the row so Email and Phone pair up beneath it — three fields
              in two columns otherwise leaves a ragged empty cell. */}
          <Field
            className="sm:col-span-2"
            data-invalid={err("fullName") ? true : undefined}
          >
            <FieldLabel htmlFor="fullName">Full name</FieldLabel>
            <Input
              id="fullName"
              placeholder="Full name"
              autoComplete="name"
              aria-invalid={err("fullName") ? true : undefined}
              {...register("fullName")}
            />
            {err("fullName") ? (
              <FieldDescription role="alert" className="text-danger">
                {err("fullName")}
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={err("email") ? true : undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="user@company.com"
              autoComplete="email"
              aria-invalid={err("email") ? true : undefined}
              {...register("email")}
            />
            {err("email") ? (
              <FieldDescription role="alert" className="text-danger">
                {err("email")}
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={err("phone") ? true : undefined}>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input
              id="phone"
              placeholder="+91 90000 00000"
              autoComplete="tel"
              aria-invalid={err("phone") ? true : undefined}
              {...register("phone")}
            />
            {err("phone") ? (
              <FieldDescription role="alert" className="text-danger">
                {err("phone")}
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
      </FormSection>

      <FormSection legend="Access">
        <FieldGroup className={COLS}>
          <Field data-invalid={err("role") ? true : undefined}>
          <FieldLabel htmlFor="role">Role</FieldLabel>
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  // A region picked for one role means nothing for another —
                  // and neither does the error it left behind.
                  setValue("regionIds", [], { shouldValidate: false });
                  setValue("stateIds", [], { shouldValidate: false });
                  clearErrors(["regionIds", "stateIds"]);
                }}
              >
                <SelectTrigger
                  id="role"
                  className="w-full"
                  aria-invalid={err("role") ? true : undefined}
                >
                  {/* Map the role key back to its label — the trigger would
                      otherwise show the raw `area_manager` key. */}
                  <SelectValue
                    placeholder={
                      roles.length ? "Select a role" : "No assignable roles"
                    }
                  >
                    {(v) =>
                      roles.find((r) => r.key === v)?.label ?? "Select a role"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roles.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
            <FieldDescription>
              Only roles below your own are listed.
            </FieldDescription>
            {err("role") ? (
              <FieldDescription role="alert" className="text-danger">
                {err("role")}
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={err("password") ? true : undefined}>
            <FieldLabel htmlFor="password">Temporary password</FieldLabel>
            <PasswordInput
              id="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              aria-invalid={err("password") ? true : undefined}
              {...register("password")}
            />
            {err("password") ? (
              <FieldDescription role="alert" className="text-danger">
                {err("password")}
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
      </FormSection>

      {/* Only when the role actually has one — a Territory heading over an
          empty box reads as a field that failed to load. Full width rather
          than two columns: a regional head's states run to thirteen chips. */}
      {roleHasTerritory(role) ? (
        <FormSection legend="Territory">
          <FieldGroup className="grid gap-4">
            <ScopeField
              role={role}
              regionIds={regionIds}
              stateIds={stateIds}
              onRegionIds={(next) =>
                setValue("regionIds", next, { shouldValidate: true })
              }
              onStateIds={(next) =>
                setValue("stateIds", next, { shouldValidate: true })
              }
              regionError={err("regionIds")}
              stateError={err("stateIds")}
            />
          </FieldGroup>
        </FormSection>
      ) : null}

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Add user
        </Button>
      </DialogFooter>
    </form>
  );
}
