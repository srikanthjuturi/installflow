import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { PurchasePlatformDialog } from "@/components/settings/PurchasePlatformDialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useAuth";
import {
  useAllPurchasePlatforms,
  useDeactivatePurchasePlatform,
  useUpdatePurchasePlatform,
} from "@/hooks/usePurchasePlatforms";
import { cn } from "@/lib/utils";
import type { PurchasePlatform } from "@/types/purchasePlatform";

type OpenDialog =
  | { kind: "add" }
  | { kind: "edit"; platform: PurchasePlatform }
  | { kind: "deactivate"; platform: PurchasePlatform }
  | null;

/** Same two-tone, never-colour-alone convention `VendorTable`'s Status column
 *  uses — the word is always present beside the dot. */
const STATUS_CLASS: Record<"Active" | "Paused", string> = {
  Active: "text-ok",
  Paused: "text-warn",
};

/**
 * Configuration → Purchase Platforms (A7) — where a vendor says a unit was
 * bought online: Amazon, Flipkart, this company's own site. A short list a
 * company sets up once; a vendor picks from it on the raise-a-ticket form and
 * may add a new one inline from the same picker.
 *
 * Reading the list is open to the whole company at the API — the vendor
 * form's own call needs it, so there is no feature key to gate on at all.
 * Adding, renaming and retiring one ARE literally Admin-only on the server
 * (`require_min_rank(ADMIN)`, no feature key behind it either) — narrower
 * than every other config screen here, which is why both the nav entry and
 * this route are gated on the signed-in role rather than Feature Access (see
 * `NavItem.adminOnly` in `components/shared/nav.ts`). `canWrite` below is
 * therefore mostly belt-and-braces: nobody else can reach this page, but the
 * server is still the one real authority (hard rule 8), so the buttons check
 * the same role rather than assume the route guard upstream.
 *
 * Retiring never deletes — a ticket may already name the row — so a paused
 * platform stays on this list (unlike the ticket form's `activeOnly` one) to
 * be renamed or brought back.
 */
export default function PurchasePlatformsPage() {
  const { data, isLoading, isError, error, refetch } =
    useAllPurchasePlatforms();
  const { data: me } = useMe();
  const canWrite = me?.role === "admin";

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const update = useUpdatePurchasePlatform();
  const deactivate = useDeactivatePurchasePlatform();

  // Only the destructive direction asks (hard rule under "Reusable component
  // strategy") — bringing a platform back fires straight through.
  function activate(platform: PurchasePlatform) {
    update.mutate(
      { id: platform.id, isActive: true },
      { onSuccess: () => toast.add({ title: `${platform.name} activated` }) }
    );
  }

  function confirmDeactivate(platform: PurchasePlatform) {
    deactivate.mutate(platform.id, {
      onSuccess: () => {
        toast.add({ title: `${platform.name} deactivated` });
        setDialog(null);
      },
    });
  }

  const columns: Column<PurchasePlatform>[] = [
    {
      id: "name",
      header: "Platform",
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => {
        const label = p.isActive ? "Active" : "Paused";
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1.25 text-xs font-semibold",
              STATUS_CLASS[label]
            )}
          >
            <span aria-hidden className="size-1.75 rounded-full bg-current" />
            {label}
          </span>
        );
      },
    },
    {
      id: "manage",
      header: "Manage",
      hideHeader: true,
      align: "right",
      cell: (p) =>
        canWrite ? (
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => setDialog({ kind: "edit", platform: p })}
            >
              Rename
              <span className="sr-only"> {p.name}</span>
            </Button>
            {p.isActive ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs font-semibold text-danger"
                onClick={() => setDialog({ kind: "deactivate", platform: p })}
              >
                Deactivate
                <span className="sr-only"> {p.name}</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs font-semibold text-ink-2"
                disabled={update.isPending}
                onClick={() => activate(p)}
              >
                Activate
                <span className="sr-only"> {p.name}</span>
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageMeta
        title="Purchase platforms"
        description="Where vendors say a unit was bought online"
      />

      <h2 className="sr-only">Purchase platforms</h2>

      {/* Not server-paged, and not paged at all — the API returns the whole
          list in one round trip, the same case `VendorBrandsPage` makes for a
          vendor's own brands, and a company sets this list up once. */}
      <DataTable
        caption="Purchase platforms, with their status"
        columns={columns}
        data={data}
        getRowId={(p) => p.id}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        errorTitle="Couldn't load purchase platforms"
        pagination={false}
        emptyTitle="No purchase platforms yet"
        emptyDescription="Add the sites and stores your vendors buy from, like Amazon or Flipkart. A vendor can also add a new one inline from the raise-a-ticket form."
        toolbarActions={
          canWrite ? (
            <Button
              type="button"
              size="toolbar"
              onClick={() => setDialog({ kind: "add" })}
            >
              <Plus data-icon="inline-start" />
              Add platform
            </Button>
          ) : null
        }
      />

      {/* Add and rename share one dialog; it unmounts on close. */}
      <PurchasePlatformDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onOpenChange={(open) => !open && setDialog(null)}
        platform={dialog?.kind === "edit" ? dialog.platform : undefined}
      />

      <ConfirmDialog
        open={dialog?.kind === "deactivate"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Deactivate ${
          dialog?.kind === "deactivate" ? dialog.platform.name : "platform"
        }?`}
        description="It stops appearing on the raise-a-ticket form. A ticket that already named it keeps its name, and you can bring it back here at any time."
        confirmLabel="Deactivate platform"
        isPending={deactivate.isPending}
        onConfirm={() =>
          dialog?.kind === "deactivate" && confirmDeactivate(dialog.platform)
        }
      />
    </>
  );
}
