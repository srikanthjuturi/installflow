import { ReceiptText } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { filterValue, useParamsWriter, withFilter } from "@/hooks/useListParams";
import { relativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  VENDOR_CREDIT_ENTRY_KINDS,
  VENDOR_CREDIT_ENTRY_KIND_LABELS,
  type VendorCreditEntry,
  type VendorCreditEntryKind,
} from "@/types/vendorCredit";
import { moneyPaise } from "@/utils/money";

/**
 * Every movement on a vendor's line: one row per ticket billed, one per payment
 * credited. It adds up to what is owed, which is why nothing else appears here —
 * a reservation is not a movement, it is the absence of one yet.
 *
 * The amount arrives already SIGNED from the server, so no client decides which
 * way a kind moves the total.
 */
export function VendorCreditEntriesTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: {
  rows?: VendorCreditEntry[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const write = useParamsWriter(params, onParams);

  const columns: Column<VendorCreditEntry>[] = [
    {
      id: "what",
      header: "What",
      sticky: true,
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">
            {VENDOR_CREDIT_ENTRY_KIND_LABELS[r.kind]}
          </div>
          {r.ticketCode ?? r.paymentCode ? (
            <div className="font-mono text-xs text-ink-3">
              {r.ticketCode ?? r.paymentCode}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "when",
      header: "When",
      cell: (r) => relativeTime(r.createdAt),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            r.amountPaise < 0 ? "text-ink" : "text-ok"
          )}
        >
          {moneyPaise(r.amountPaise)}
        </span>
      ),
    },
  ];

  const filters: TypedFilterDef<VendorCreditEntry>[] = [
    {
      id: "kind",
      label: "Kind",
      variant: "pills",
      allLabel: "All",
      options: VENDOR_CREDIT_ENTRY_KINDS.map((k) => ({
        value: k,
        label: VENDOR_CREDIT_ENTRY_KIND_LABELS[k],
      })),
      value: filterValue(params, "kind"),
      onChange: (v) => write((p) => withFilter(p, "kind", v)),
      match: (r, value) => r.kind === (value as VendorCreditEntryKind),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load the statement"
      caption="Every ticket billed and every payment credited, newest first"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      filters={filters}
      server={{ meta, params, onParams }}
      minWidth="28rem"
      emptyIcon={ReceiptText}
      emptyTitle="Nothing billed yet"
      emptyDescription="A ticket appears here when it closes."
      filteredEmptyTitle="Nothing matches"
      filteredEmptyDescription="Try the other kind."
    />
  );
}
