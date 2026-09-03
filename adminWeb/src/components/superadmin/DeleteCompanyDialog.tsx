import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/components/ui/toast";
import { useDeleteCompany } from "@/hooks/useCompanies";
import type { Company } from "@/types/company";

/**
 * Confirm-before-delete. Delete is a soft-delete server-side (the company is
 * retired, not purged), which is what the copy promises.
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

  if (!company) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${company.name}?`}
      description="This retires the company and revokes its members' access to it. Existing user identities are kept, but they lose this company."
      confirmLabel="Delete company"
      isPending={del.isPending}
      onConfirm={() =>
        del.mutate(company.id, {
          onSuccess: () => {
            toast.add({ title: `${company.name} deleted` });
            onOpenChange(false);
          },
        })
      }
    />
  );
}
