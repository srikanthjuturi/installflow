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
import { Spinner } from "@/components/ui/spinner";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove {user.fullName ?? user.email}?</DialogTitle>
              <DialogDescription>
                They lose access to this company. Their account is kept, so they
                can be added again later.
              </DialogDescription>
            </DialogHeader>

            {/* The failure is reported in the toaster (App.tsx), not here. */}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(user.membershipId, {
                    onSuccess: () => {
                      toast.add({
                        title: `${user.fullName ?? user.email} removed`,
                      });
                      onOpenChange(false);
                    },
                  })
                }
              >
                {del.isPending ? <Spinner data-icon="inline-start" /> : null}
                Remove user
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
