import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/masters/ConfirmDeleteDialog";
import { VendorFormDialog } from "@/components/masters/VendorFormDialog";
import { ReissueVendorPasswordDialog } from "@/components/masters/ReissueVendorPasswordDialog";
import { VendorTable } from "@/components/masters/VendorTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { useDeleteVendor, useVendors } from "@/hooks/useVendors";
import type { Vendor } from "@/types/vendor";

/**
 * One discriminated union drives every dialog on this screen, rather than three
 * booleans plus a "which row" ref that can disagree with each other.
 */
type OpenDialog =
  | { kind: "add" }
  | { kind: "edit"; vendor: Vendor }
  | { kind: "delete"; vendor: Vendor }
  | { kind: "reissue"; vendor: Vendor }
  | null;

export default function VendorsPage() {
  // The page owns the query string; the table reports intent into it. Seeded
  // from `?search=`, which is where global search lands a vendor hit — a vendor
  // is edited on this screen and has no detail route.
  const [params, setParams] = useUrlSeededListParams();
  const { data, isLoading, isError, error, refetch } = useVendors(params);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const remove = useDeleteVendor();

  // Presentation only — the server enforces both the feature and a National
  // Head rank floor (hard rule 8).
  const { has } = useFeatureAccess();
  const canEdit = has("vendors.edit");

  function confirmDelete(vendor: Vendor) {
    remove.mutate(vendor.id, {
      onSuccess: () => {
        toast.add({ title: `${vendor.name} removed` });
        setDialog(null);
      },
      // A failure — a vendor that still brands models comes back as a 409
      // naming the count — is reported by the toaster in App.tsx. The dialog
      // stays open so the message is read next to the thing it is about.
    });
  }

  return (
    <>
      <PageMeta
        title="Vendors"
        description="The companies whose products you install"
      />

      <h2 className="sr-only">Vendors</h2>
      <VendorTable
        vendors={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        canEdit={canEdit}
        onEdit={(vendor) => setDialog({ kind: "edit", vendor })}
        onDelete={(vendor) => setDialog({ kind: "delete", vendor })}
        onReissuePassword={(vendor) => setDialog({ kind: "reissue", vendor })}
        toolbarActions={
          canEdit ? (
            <Button
              type="button"
              className="h-10"
              onClick={() => setDialog({ kind: "add" })}
            >
              <Plus data-icon="inline-start" />
              Add vendor
            </Button>
          ) : null
        }
      />

      {/* Add and edit share one dialog; it unmounts on close, so an edit never
          opens holding the previous row's values. */}
      <VendorFormDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onOpenChange={(open) => !open && setDialog(null)}
        vendor={dialog?.kind === "edit" ? dialog.vendor : undefined}
      />

      <ReissueVendorPasswordDialog
        open={dialog?.kind === "reissue"}
        onOpenChange={(open) => !open && setDialog(null)}
        vendor={dialog?.kind === "reissue" ? dialog.vendor : undefined}
      />

      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Remove ${dialog?.kind === "delete" ? dialog.vendor.name : "vendor"}?`}
        description={
          dialog?.kind === "delete" && dialog.vendor.modelCount > 0
            ? `${dialog.vendor.name} is the brand on ${dialog.vendor.modelCount} product model${
                dialog.vendor.modelCount === 1 ? "" : "s"
              }. Reassign them to another vendor first — this will be refused otherwise.`
            : "The vendor stops appearing in the brand picker. Product models that already carry the brand keep it."
        }
        confirmLabel="Remove vendor"
        onConfirm={() =>
          dialog?.kind === "delete" && confirmDelete(dialog.vendor)
        }
        isPending={remove.isPending}
      />
    </>
  );
}
