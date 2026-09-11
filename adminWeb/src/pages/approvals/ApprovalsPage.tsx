import { useState } from "react";
import { useSearchParams } from "react-router";
import { ApprovalTable } from "@/components/approvals/ApprovalTable";
import { ApproveBrandDialog } from "@/components/approvals/ApproveBrandDialog";
import { ApproveProductDialog } from "@/components/approvals/ApproveProductDialog";
import { BrandApprovalTable } from "@/components/approvals/BrandApprovalTable";
import {
  RejectBrandDialog,
  RejectProductDialog,
} from "@/components/approvals/RejectProductDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import {
  useApprovals,
  useBrandApprovals,
  usePendingSplit,
} from "@/hooks/useApprovals";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type {
  ApprovalKind,
  BrandSubmission,
  ProductSubmission,
} from "@/types/approval";

/**
 * What vendors have submitted and are waiting on: PRODUCTS to price, and
 * BRANDS they have added from their portal.
 *
 * A vendor may add products to their own book but not price them — what a
 * technician earns is withheld from a vendor, and what a vendor is charged is a
 * term between them and the company. So a submission arrives here unpriced and
 * unticketable, and a National Head or an Admin either sets both figures or
 * refuses it with a reason the vendor can act on. A brand is the same decision
 * without the prices.
 *
 * The half on screen is `?kind=` in the URL, so a brand notification can land
 * on the Brands half and a manager can share what they are looking at.
 */
export default function ApprovalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const kind: ApprovalKind =
    searchParams.get("kind") === "brands" ? "brands" : "products";
  const pending = usePendingSplit();

  return (
    <>
      <PageMeta
        title="Approvals"
        description="Price and approve products vendors have submitted, and the brands they add"
      />

      <h2 className="sr-only">Approvals</h2>

      <KindSwitch
        kind={kind}
        pending={pending}
        // Replaces the whole query string: each half keeps its own status and
        // search, so carrying one half's `?status=rejected` into the other
        // would open it filtered for a reason nobody chose.
        onKind={(next) =>
          setSearchParams(next === "brands" ? { kind: "brands" } : {})
        }
      />

      {/* Keyed, so switching halves starts the other from its own defaults
          rather than inheriting a page number from this one. */}
      {kind === "brands" ? <BrandsHalf key="brands" /> : <ProductsHalf key="products" />}
    </>
  );
}

/**
 * Two buttons, not tabs: the page is one list at a time and the choice is in
 * the URL, the same reasoning — and the same look — as the status pills below
 * it. The count is on each so the half with work in it is visible from the
 * other; the rail badge is one total and cannot say which.
 */
function KindSwitch({
  kind,
  pending,
  onKind,
}: {
  kind: ApprovalKind;
  pending: { products?: number; brands?: number };
  onKind: (kind: ApprovalKind) => void;
}) {
  const options: { value: ApprovalKind; label: string; count?: number }[] = [
    { value: "products", label: "Products", count: pending.products },
    { value: "brands", label: "Brands", count: pending.brands },
  ];
  return (
    <div
      role="group"
      aria-label="What to review"
      className="mb-3.5 flex flex-wrap gap-2"
    >
      {options.map((o) => {
        const active = kind === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onKind(o.value)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
              active
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-input bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
            )}
          >
            {o.label}
            {/* Only when something is waiting — a "0" pill is noise, and an
                unloaded count must not claim there is work. */}
            {o.count ? (
              <span
                className={cn(
                  "rounded-full px-1.75 py-0.25 text-[11px] tabular-nums",
                  active ? "bg-white/20" : "bg-warn-bg text-warn"
                )}
              >
                {o.count}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** One discriminated union drives both dialogs of a half. */
type ProductDialog =
  | { kind: "approve"; submission: ProductSubmission }
  | { kind: "reject"; submission: ProductSubmission }
  | null;

function ProductsHalf() {
  /*
   * The half owns the query string; the table reports intent into it.
   *
   * It starts EXPLICITLY on `pending` rather than relying on the server's
   * default for a missing value. The two agree, but the pill does not read the
   * server: `filterValue` falls back to the "All" sentinel when a filter is
   * unset, so an implicit default lit the All pill above a list that was only
   * ever the backlog. A URL carrying its own `status` still overrides this.
   */
  const [params, setParams] = useUrlSeededListParams(
    { filters: { status: "pending" } },
    ["status"]
  );
  const { data, isLoading, isError, error, refetch } = useApprovals(params);
  const [dialog, setDialog] = useState<ProductDialog>(null);

  return (
    <>
      <ApprovalTable
        submissions={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        onApprove={(submission) => setDialog({ kind: "approve", submission })}
        onReject={(submission) => setDialog({ kind: "reject", submission })}
      />

      {/* Both dialogs close from their mutation's `onSuccess`, never on click,
          so a failure — including the 409 when a colleague decided the same row
          first — leaves the dialog standing over the toast. */}
      <ApproveProductDialog
        open={dialog?.kind === "approve"}
        onOpenChange={(open) => !open && setDialog(null)}
        submission={dialog?.kind === "approve" ? dialog.submission : undefined}
      />
      <RejectProductDialog
        open={dialog?.kind === "reject"}
        onOpenChange={(open) => !open && setDialog(null)}
        submission={dialog?.kind === "reject" ? dialog.submission : undefined}
      />
    </>
  );
}

type BrandDialog =
  | { kind: "approve"; submission: BrandSubmission }
  | { kind: "reject"; submission: BrandSubmission }
  | null;

function BrandsHalf() {
  const [params, setParams] = useUrlSeededListParams(
    { filters: { status: "pending" } },
    ["status"]
  );
  const { data, isLoading, isError, error, refetch } = useBrandApprovals(params);
  const [dialog, setDialog] = useState<BrandDialog>(null);

  return (
    <>
      <BrandApprovalTable
        submissions={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        onApprove={(submission) => setDialog({ kind: "approve", submission })}
        onReject={(submission) => setDialog({ kind: "reject", submission })}
      />

      <ApproveBrandDialog
        open={dialog?.kind === "approve"}
        onOpenChange={(open) => !open && setDialog(null)}
        submission={dialog?.kind === "approve" ? dialog.submission : undefined}
      />
      <RejectBrandDialog
        open={dialog?.kind === "reject"}
        onOpenChange={(open) => !open && setDialog(null)}
        submission={dialog?.kind === "reject" ? dialog.submission : undefined}
      />
    </>
  );
}
