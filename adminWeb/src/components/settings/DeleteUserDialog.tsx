import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useDeleteUser } from "@/hooks/useCompanyUsers";
import type { CompanyUser } from "@/types/user";

/**
 * Remove a user from THIS company (soft-delete of the membership). The person's
 * identity is kept — they simply lose access to this company.
 */
export function DeleteUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: CompanyUser;
}) {
  const del = useDeleteUser();

  if (!user) return null;

  const who = user.fullName ?? user.email;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${who}?`}
      description="They lose access to this company. Their account is kept, so they can be added again later."
      confirmLabel="Remove user"
      isPending={del.isPending}
      onConfirm={() =>
        del.mutate(user.membershipId, {
          onSuccess: () => {
            toast.add({ title: `${who} removed` });
            onOpenChange(false);
          },
        })
      }
    />
  );
}
