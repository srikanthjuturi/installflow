import { ImageOff } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { ApprovalBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { relativeTime } from "@/lib/relativeTime";
import { APPROVAL_LABELS, APPROVAL_STATUSES } from "@/types/approval";
import type { ApprovalStatus, ProductSubmission } from "@/types/approval";
import type { ListParams, PaginationMeta } from "@/types/api";

interface ApprovalTableProps {
  /** Exactly the rows the server returned for `params` — one page of them. */
  submissions?: ProductSubmission[];
  /** The envelope's pagination block. Absent on the first load. */
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onApprove: (submission: ProductSubmission) => void;
  onReject: (submission: ProductSubmission) => void;
}

export function ApprovalTable({
  submissions,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  onApprove,
  onReject,
}: ApprovalTableProps) {
  // Search and the status filter are query parameters, so each control writes
  // through here rather than narrowing rows in the browser.
  const write = useParamsWriter(params, onParams);

  /*
   * No `sortValue` on any column. The server orders this queue itself — pending
   * first with the longest wait leading, then decided most-recent-first — and
   * `DataTable`'s server mode wires only page and page size through
   * `server.onParams`. A header arrow would reorder nothing and announce an
   * `aria-sort` that is not true. The same note `VendorTable` carries.
   */
  const columns: Column<ProductSubmission>[] = [
    {
      id: "product",
      header: "Product",
      cell: (s) => (
        <div className="flex items-start gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-3 text-ink-3"
            aria-hidden
          >
            {/* The first photo is the product's face everywhere a list draws
                one. A missing photo is visible at a glance rather than being a
                blank cell — the same treatment `ModelChip` gives it. */}
            {s.imageUrls[0] ? (
              <img
                src={s.imageUrls[0]}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              <ImageOff className="size-3.5" />
            )}
          </span>
          <div className="leading-tight">
            <div className="font-medium">{s.name}</div>
            {s.capacity ? (
              <div className="text-xs text-ink-3">{s.capacity}</div>
            ) : null}
            {/* The reason is why anybody opens the Rejected filter, so it goes
                on the row rather than behind a hover. */}
            {s.approvalStatus === "rejected" && s.rejectionReason ? (
              <div className="mt-0.5 text-xs text-ink-3">
                {s.rejectionReason}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: "brand",
      header: "Brand",
      // What goes on the unit, with who submitted it under it — a vendor may
      // sell several brands, so the two are no longer one name.
      cell: (s) => (
        <div className="leading-tight">
          <div>{s.brandName}</div>
          <div className="text-xs text-ink-3">{s.vendorName}</div>
        </div>
      ),
    },
    {
      id: "category",
      header: "Category",
      cellClassName: "text-xs text-ink-2",
      cell: (s) => s.nodePath.join(" › "),
    },
    {
      id: "coverage",
      header: "Certified",
      cellClassName: "tabular-nums",
      /*
       * How many technicians could actually take a job on this node.
       *
       * ZERO is the interesting answer and the reason this column exists. A
       * vendor may file a product under a brand-new sub-category nobody is
       * certified on; approve it and every ticket raised there escalates
       * immediately, with nothing on any screen saying why. Shown before the
       * decision rather than discovered a week later.
       */
      cell: (s) => (
        <span className={s.technicianCount === 0 ? "text-warn" : undefined}>
          {s.technicianCount}
        </span>
      ),
    },
    {
      id: "submitted",
      header: "Submitted",
      cell: (s) => (
        <div className="leading-tight">
          {/* Null when the product never went through approval — everything
              that predates this feature. A dash, not an invented date. */}
          <div>{s.submittedAt ? relativeTime(s.submittedAt) : "—"}</div>
          {s.decidedByName ? (
            <div className="text-xs text-ink-3">by {s.decidedByName}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => <ApprovalBadge status={s.approvalStatus} />,
    },
    {
      id: "manage",
      header: "Manage",
      hideHeader: true,
      align: "right",
      // Only a pending row can be decided — the server 409s anything else with
      // ALREADY_DECIDED, so offering the buttons on a settled row would be the
      // UI promising something the API refuses.
      cell: (s) =>
        s.approvalStatus === "pending" ? (
          <div className="flex items-center justify-end gap-3">
            {/* Buttons, not links: they open dialogs rather than navigating. */}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => onApprove(s)}
            >
              Approve
              <span className="sr-only"> {s.name}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-ink-2"
              onClick={() => onReject(s)}
            >
              Reject
              <span className="sr-only"> {s.name}</span>
            </Button>
          </div>
        ) : null,
    },
  ];

  /*
   * Controlled against the query string. `match` is part of the filter contract
   * but is never called in server mode — the rows arrive already narrowed — so
   * it is kept as an accurate statement of what the filter means rather than a
   * second implementation of it.
   */
  const filters: TypedFilterDef<ProductSubmission>[] = [
    {
      id: "status",
      label: "Status",
      // Three options, so pills rather than a dropdown — under the seven-option
      // threshold `Toolbar` uses to decide.
      variant: "pills",
      allLabel: "All",
      options: APPROVAL_STATUSES.map((s) => ({
        // Lowercase on the wire, the word people read on the chip.
        value: s,
        label: APPROVAL_LABELS[s],
      })),
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
      match: (s, value) => s.approvalStatus === (value as ApprovalStatus),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load approvals"
      caption="Products vendors have submitted, with the brand and vendor, where each is filed, how many technicians are certified for it, when it arrived and whether it has been decided"
      data={submissions}
      columns={columns}
      getRowId={(s) => s.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search product, brand, vendor or category…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      minWidth="64rem"
      emptyTitle="Nothing waiting"
      emptyDescription="Products a vendor submits appear here. Nothing can be ticketed against one until both prices are set."
      filteredEmptyTitle="No products match"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
