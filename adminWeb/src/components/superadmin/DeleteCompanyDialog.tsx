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
import { useDeleteCompany } from "@/hooks/useCompanies";
import type { Company } from "@/types/company";

/**
 * Confirm-before-delete. The codebase has no shared confirm primitive, so this
 * composes one from the dialog with a destructive action. Delete is a
 * soft-delete server-side (the company is retired, not purged).
 */
export function DeleteCompanyDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company;
}) {
  const del = useDeleteCompany();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {company ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete {company.name}?</DialogTitle>
              <DialogDescription>
                This retires the company and revokes its members' access to it.
                Existing user identities are kept, but they lose this company.
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
                  del.mutate(company.id, {
                    onSuccess: () => {
                      toast.add({ title: `${company.name} deleted` });
                      onOpenChange(false);
                    },
                  })
                }
              >
                {del.isPending ? <Spinner data-icon="inline-start" /> : null}
                Delete company
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
