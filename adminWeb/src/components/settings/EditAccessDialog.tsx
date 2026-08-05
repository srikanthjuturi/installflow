import { useForm, useWatch } from "react-hook-form";
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
  FieldSet,
} from "@/components/ui/field";
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
import { useUpdateUserAccess } from "@/hooks/useSettings";
import { RoleScopeFields, ServerError } from "./InviteUserDialog";
import { editAccessSchema, statusOptions, type EditAccessValues } from "./userSchema";
import type { User } from "@/types";

interface EditAccessDialogProps {
  /** The row being edited — `null` closes the dialog. */
  user: User | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Change one user's role, scope and status.
 *
 * Identity is not editable here: a name or work email change is an account
 * change, not an access change. Saving records what this person should be
 * allowed to do — the server is what enforces it.
 */
export function EditAccessDialog({ user, onOpenChange }: EditAccessDialogProps) {
  const update = useUpdateUserAccess();

  return (
    <Dialog open={user !== null} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit access</DialogTitle>
          {user ? (
            <DialogDescription>
              {user.name} · {user.email}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {/* Keyed on the row, so opening a different user re-prefills instead of
            keeping the last one's values. */}
        {user ? (
          <EditAccessForm
            key={user.id}
            user={user}
            isSubmitting={update.isPending}
            error={update.error}
            onSubmit={(values) =>
              update.mutate(
                { id: user.id, ...values },
                {
                  onSuccess: (saved) => {
                    toast.add({
                      title: `Access updated for ${saved.name}`,
                      description: `${saved.role} · ${saved.region} · ${saved.status}`,
                    });
                    onOpenChange(false);
                  },
                },
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditAccessForm({
  user,
  onSubmit,
  isSubmitting,
  error,
}: {
  user: User;
  onSubmit: (values: EditAccessValues) => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<EditAccessValues>({
    resolver: zodResolver(editAccessSchema),
    // `region` is the scope column: "All India", a region or an ASM area.
    defaultValues: { role: user.role, scope: user.region, status: user.status },
  });

  const role = useWatch({ control, name: "role" });
  const scope = useWatch({ control, name: "scope" });
  const status = useWatch({ control, name: "status" });

  const statuses = statusOptions(user.status);

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="contents">
      <FieldSet>
        <FieldGroup className="gap-4">
          <RoleScopeFields
            idPrefix="edit-access"
            role={role}
            scope={scope}
            roleError={errors.role?.message}
            scopeError={errors.scope?.message}
            onChange={(next) => {
              setValue("role", next.role, { shouldValidate: false });
              setValue("scope", next.scope, { shouldValidate: Boolean(errors.scope) });
            }}
          />

          <Field>
            <FieldLabel htmlFor="edit-access-status">Status</FieldLabel>
            <Select
              value={status}
              onValueChange={(value) =>
                setValue("status", value as User["status"], { shouldValidate: false })
              }
            >
              <SelectTrigger
                id="edit-access-status"
                className="w-full"
                aria-describedby="edit-access-status-description"
              >
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {statuses.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription id="edit-access-status-description" className="text-xs">
              {user.status === "Invited"
                ? "Invited clears itself when they accept. A pending invite can still be suspended."
                : "A suspended user keeps their record but cannot sign in."}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <ServerError error={error} />

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
