import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { AvatarPicker } from "@/components/shared/AvatarPicker";
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
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { useInviteUser } from "@/hooks/useSettings";
import { useTerritory } from "@/hooks/useTerritory";
import {
  NATIONAL_SCOPE,
  ROLE_OPTIONS,
  SCOPE_META,
  inviteUserSchema,
  reconcileScope,
  scopeOptions,
  type InviteUserValues,
} from "./userSchema";
import type { Role } from "@/types";

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Invite someone to the console. The invitee starts as "Invited" and stays
 * there until they accept — nothing on this form makes anyone Active, and
 * nothing here grants permission: the role and scope are recorded for the
 * server, which is where RBAC is enforced.
 */
export function InviteUserDialog({
  open,
  onOpenChange,
}: InviteUserDialogProps) {
  const invite = useInviteUser();

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            They receive an email invite and stay <strong>Invited</strong> until
            they accept.
          </DialogDescription>
        </DialogHeader>

        {/* Remounted on every open, so a cancelled invite never leaves values
            behind for the next one. */}
        {open ? (
          <InviteUserForm
            isSubmitting={invite.isPending}
            error={invite.error}
            onSubmit={(values) =>
              invite.mutate(
                {
                  name: values.name,
                  email: values.email,
                  role: values.role,
                  scope: values.scope,
                  photoUrl: values.photo,
                },
                {
                  onSuccess: (user) => {
                    toast.add({
                      title: `Invite sent to ${user.email}`,
                      description: `${user.role} · ${user.region}. Invited until they accept.`,
                    });
                    onOpenChange(false);
                  },
                }
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteUserForm({
  onSubmit,
  isSubmitting,
  error,
}: {
  onSubmit: (values: InviteUserValues) => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<InviteUserValues>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { name: "", email: "", role: "ASM", scope: "", photo: undefined },
  });

  const role = useWatch({ control, name: "role" });
  const scope = useWatch({ control, name: "scope" });
  // Initials fallback tracks the name until a photo is chosen.
  const watchedName = useWatch({ control, name: "name" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="contents">
      <FieldSet>
        <FieldGroup className="gap-4">
          <Field orientation="horizontal">
            <Controller
              name="photo"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-4">
                  <AvatarPicker
                    name={watchedName}
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v ?? undefined)}
                    label="user"
                    avatarClassName="size-16 text-xl"
                  />
                  <div className="min-w-0">
                    <FieldLabel>Profile photo</FieldLabel>
                    <FieldDescription>
                      Optional. Tap the camera to add and crop a photo.
                    </FieldDescription>
                    {field.value ? (
                      <button
                        type="button"
                        onClick={() => field.onChange(undefined)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-danger"
                      >
                        <Trash2 className="size-3" aria-hidden />
                        Remove photo
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            />
          </Field>

          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="invite-name">Full name</FieldLabel>
            <Input
              id="invite-name"
              autoComplete="name"
              placeholder="Full name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "invite-name-error" : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <FieldDescription
                id="invite-name-error"
                role="alert"
                className="text-danger"
              >
                {errors.name.message}
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="invite-email">Work email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@installflow.in"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "invite-email-error" : undefined}
              {...register("email")}
            />
            {errors.email ? (
              <FieldDescription
                id="invite-email-error"
                role="alert"
                className="text-danger"
              >
                {errors.email.message}
              </FieldDescription>
            ) : null}
          </Field>

          <RoleScopeFields
            idPrefix="invite"
            role={role}
            scope={scope}
            roleError={errors.role?.message}
            scopeError={errors.scope?.message}
            onChange={(next) => {
              setValue("role", next.role, { shouldValidate: false });
              setValue("scope", next.scope, {
                shouldValidate: Boolean(errors.scope),
              });
            }}
          />
        </FieldGroup>
      </FieldSet>

      <ServerError error={error} />

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Send invite
        </Button>
      </DialogFooter>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Shared with EditAccessDialog: role and scope are one unit, because the role
   decides what a scope is. Validation state is wired the same way as every
   other form — data-invalid on the Field, aria-invalid on the control, and the
   message in a role="alert" the control points at.
   ---------------------------------------------------------------------- */

export function RoleScopeFields({
  idPrefix,
  role,
  scope,
  roleError,
  scopeError,
  onChange,
}: {
  idPrefix: string;
  role: Role;
  scope: string;
  roleError?: string;
  scopeError?: string;
  onChange: (next: { role: Role; scope: string }) => void;
}) {
  // Scope choices are territory data, so a region or area that nobody covers
  // can never be assigned.
  const { data: territory, isLoading, isError } = useTerritory();

  const meta = SCOPE_META[role];
  const options = scopeOptions(role, territory, scope);
  const roleId = `${idPrefix}-role`;
  const scopeId = `${idPrefix}-scope`;

  const placeholder = isLoading
    ? "Loading territory…"
    : isError
      ? "Territory unavailable"
      : meta.placeholder;

  return (
    <>
      <Field data-invalid={roleError ? true : undefined}>
        <FieldLabel htmlFor={roleId}>Role</FieldLabel>
        <Select
          value={role}
          onValueChange={(value) => {
            const next = value as Role;
            onChange({
              role: next,
              scope: reconcileScope(next, scope, territory),
            });
          }}
        >
          <SelectTrigger
            id={roleId}
            className="w-full"
            aria-invalid={roleError ? true : undefined}
            aria-describedby={roleError ? `${roleId}-error` : undefined}
          >
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ROLE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {roleError ? (
          <FieldDescription
            id={`${roleId}-error`}
            role="alert"
            className="text-danger"
          >
            {roleError}
          </FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={scopeError ? true : undefined}>
        <FieldLabel htmlFor={scopeId}>{meta.label}</FieldLabel>
        {meta.kind === "national" ? (
          /* An NH owns every region, so there is nothing to pick. */
          <Input id={scopeId} value={NATIONAL_SCOPE} readOnly disabled />
        ) : (
          <Select
            value={scope}
            onValueChange={(value) =>
              onChange({ role, scope: value as string })
            }
            disabled={options.length === 0}
          >
            <SelectTrigger
              id={scopeId}
              className="w-full"
              aria-invalid={scopeError ? true : undefined}
              aria-describedby={
                scopeError ? `${scopeId}-error` : `${scopeId}-description`
              }
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        {scopeError ? (
          <FieldDescription
            id={`${scopeId}-error`}
            role="alert"
            className="text-danger"
          >
            {scopeError}
          </FieldDescription>
        ) : (
          <FieldDescription id={`${scopeId}-description`} className="text-xs">
            {meta.help}
          </FieldDescription>
        )}
      </Field>
    </>
  );
}

/** Mutations fail loudly in the dialog rather than closing it silently. */
export function ServerError({ error }: { error: unknown }) {
  if (!error) return null;

  return (
    <p
      role="alert"
      className="rounded-md bg-danger-bg px-3 py-2.5 text-xs text-danger"
    >
      {error instanceof Error
        ? error.message
        : "Something went wrong. Try again."}
    </p>
  );
}
