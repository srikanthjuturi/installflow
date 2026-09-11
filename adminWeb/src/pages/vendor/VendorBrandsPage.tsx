import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { ApprovalBadge } from "@/components/shared/StatusBadge";
import { OwnBrandDialog } from "@/components/vendor/OwnBrandDialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { MAX_BRANDS } from "@/components/masters/vendorSchema";
import { useOwnBrands, useWithdrawOwnBrand } from "@/hooks/useVendors";
import type { VendorBrand } from "@/types/vendor";

type OpenDialog =
  | { kind: "add" }
  | { kind: "edit"; brand: VendorBrand }
  | { kind: "withdraw"; brand: VendorBrand }
  | null;

/**
 * The brands a vendor sells, and the ones it has asked for.
 *
 * A vendor adds a brand here and it WAITS: a National Head or an Admin approves
 * it on Approvals, and only then can the vendor's products carry it. The office
 * can also add brands for them from the Vendors screen, which are approved as
 * they are typed — so an approved brand is the office's to rename or remove,
 * and this page offers no action on one.
 *
 * Not server-paged, and not paged at all: the API returns the whole list, and
 * a vendor holds at most twenty brands of any status.
 */
export default function VendorBrandsPage() {
  const { data, isLoading, isError, error, refetch } = useOwnBrands();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const withdraw = useWithdrawOwnBrand();

  // The ceiling counts every brand on the list, waiting ones included — the
  // server's rule, so an approval can never take a vendor past it.
  const full = (data?.length ?? 0) >= MAX_BRANDS;

  const columns: Column<VendorBrand>[] = [
    {
      id: "name",
      header: "Brand",
      cell: (b) => (
        <div className="leading-tight">
          <div className="font-medium">{b.name}</div>
          {/* The reason is what they need to act on, so it sits on the row. */}
          {b.approvalStatus === "rejected" && b.rejectionReason ? (
            <div className="mt-0.5 text-xs text-ink-3">{b.rejectionReason}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (b) => <ApprovalBadge status={b.approvalStatus} />,
    },
    {
      id: "products",
      header: "Products",
      cellClassName: "tabular-nums",
      cell: (b) => b.productCount,
    },
    {
      id: "manage",
      header: "Manage",
      hideHeader: true,
      align: "right",
      cell: (b) =>
        // An approved brand is the office's — products may carry it, and a
        // rename would restate every one. The server refuses it either way.
        b.approvalStatus === "approved" ? null : (
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => setDialog({ kind: "edit", brand: b })}
            >
              {b.approvalStatus === "rejected" ? "Fix and resubmit" : "Rename"}
              <span className="sr-only"> {b.name}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-danger"
              onClick={() => setDialog({ kind: "withdraw", brand: b })}
            >
              Withdraw
              <span className="sr-only"> {b.name}</span>
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageMeta title="My brands" description="The brands you sell" />

      <h2 className="mb-4 text-lg font-semibold">My brands</h2>

      <DataTable
        caption="Your brands, with whether each is approved and how many of your products carry it"
        columns={columns}
        data={data}
        getRowId={(b) => b.id}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        errorTitle="Couldn't load your brands"
        pagination={false}
        emptyTitle="No brands yet"
        emptyDescription="Add the brands you sell. Once one is approved you can choose it when adding a product."
        toolbarActions={
          <Button
            type="button"
            size="toolbar"
            disabled={full}
            title={
              full
                ? `Up to ${MAX_BRANDS} brands — withdraw one to add another`
                : undefined
            }
            onClick={() => setDialog({ kind: "add" })}
          >
            <Plus data-icon="inline-start" />
            Add brand
          </Button>
        }
      />

      <p className="mt-3.5 text-xs text-ink-3">
        A brand you add waits for approval. We will let you know as soon as it
        is decided.
      </p>

      {dialog?.kind === "add" || dialog?.kind === "edit" ? (
        <OwnBrandDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          brand={dialog.kind === "edit" ? dialog.brand : undefined}
        />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === "withdraw"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Withdraw ${dialog?.kind === "withdraw" ? dialog.brand.name : "brand"}?`}
        description={
          dialog?.kind === "withdraw" &&
          dialog.brand.approvalStatus === "pending"
            ? "It stops waiting for approval. You can add it again later."
            : "It is removed from your list. You can add it again later."
        }
        confirmLabel="Withdraw brand"
        isPending={withdraw.isPending}
        onConfirm={() =>
          dialog?.kind === "withdraw" &&
          withdraw.mutate(dialog.brand.id, {
            onSuccess: () => {
              toast.add({ title: `${dialog.brand.name} withdrawn` });
              setDialog(null);
            },
          })
        }
      />
    </>
  );
}
