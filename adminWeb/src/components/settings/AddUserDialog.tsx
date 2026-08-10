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
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useAssignableRoles, useCreateUser } from "@/hooks/useCompanyUsers";
import { ScopeField } from "./ScopeField";
import {
  createUserResolver,
  EMPTY_INVITE,
  type CreateUserValues,
} from "./companyUserSchema";

export function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
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
  const pincodes = useWatch({ control, name: "pincodes" });

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
        pincodes: values.pincodes,
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

      <FieldGroup className="gap-4">
        <Field data-invalid={err("fullName") ? true : undefined}>
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
                  setValue("pincodes", [], { shouldValidate: false });
                  clearErrors(["regionIds", "pincodes"]);
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

        <ScopeField
          role={role}
          regionIds={regionIds}
          pincodes={pincodes}
          onRegionIds={(next) =>
            setValue("regionIds", next, { shouldValidate: true })
          }
          onPincodes={(next) =>
            setValue("pincodes", next, { shouldValidate: true })
          }
          regionError={err("regionIds")}
          pincodeError={err("pincodes")}
        />

        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      </FieldGroup>

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
