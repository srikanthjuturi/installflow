import { useState } from "react";
import { Plus } from "lucide-react";
import { FranchiseeFormDialog } from "@/components/franchisees/FranchiseeFormDialog";
import { FranchiseeTable } from "@/components/franchisees/FranchiseeTable";
import { PincodeRangesDialog } from "@/components/franchisees/PincodeRangesDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { useFranchiseeOptions, useFranchisees } from "@/hooks/useFranchisees";
import type { Franchisee } from "@/types/franchisee";

/**
 * One discriminated union drives every dialog on this screen, rather than three
 * booleans plus a "which row" ref that can disagree with each other. Add hands
 * the created row to step 2 — the pincodes dialog — in `onCreated`.
 */
type OpenDialog =
  | { kind: "add" }
  | { kind: "edit"; franchisee: Franchisee }
  | { kind: "pincodes"; franchisee: Franchisee }
  | null;

export default function FranchiseesPage() {
  const [params, setParams] = useUrlSeededListParams();
  const { data, isLoading, isError, error, refetch } = useFranchisees(params);

  // The home's name is what the carve-out copy and every "handed back to …"
  // line needs. It comes off the OPTIONS cached list — the same one the
  // Technicians screen fetches and any franchisee write invalidates — rather
  // than a second detail request for a name the list itself is refusing to
  // specialise.
  const { data: options } = useFranchiseeOptions();
  const homeName =
    options?.find((o) => o.isHome)?.name ?? "the home franchisee";

  const [dialog, setDialog] = useState<OpenDialog>(null);

  // Presentation only — the server enforces both the feature and an Admin/NH
  // floor (hard rule 8).
  const { has } = useFeatureAccess();
  const canManage = has("franchisees.manage");

  return (
    <>
      <PageMeta
        title="Franchisees"
        description="Franchisees, the pincodes each one owns, and their admins."
      />

      <h2 className="sr-only">Franchisees</h2>
      <FranchiseeTable
        franchisees={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        canManage={canManage}
        onEdit={(franchisee) => setDialog({ kind: "edit", franchisee })}
        onPincodes={(franchisee) => setDialog({ kind: "pincodes", franchisee })}
        toolbarActions={
          canManage ? (
            <Button
              type="button"
              size="toolbar"
              onClick={() => setDialog({ kind: "add" })}
            >
              <Plus data-icon="inline-start" />
              Add franchisee
            </Button>
          ) : null
        }
      />

      {/* Add and edit share one dialog; it unmounts on close, so an edit never
          opens holding the previous row's values. */}
      <FranchiseeFormDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onOpenChange={(open) => !open && setDialog(null)}
        franchisee={dialog?.kind === "edit" ? dialog.franchisee : undefined}
        /* Step 1 → step 2, the whole reason add takes no pincodes (§4.1). */
        onCreated={(created) => {
          setDialog({ kind: "pincodes", franchisee: created });
          // The row is not in the page's list yet; refetch brings it in
          // behind the open dialog.
          void refetch();
        }}
      />

      <PincodeRangesDialog
        open={dialog?.kind === "pincodes"}
        onOpenChange={(open) => !open && setDialog(null)}
        franchisee={dialog?.kind === "pincodes" ? dialog.franchisee : undefined}
        homeName={homeName}
      />
    </>
  );
}