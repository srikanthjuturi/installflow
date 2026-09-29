import { Wallet } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { filterValue, useParamsWriter, withFilter } from "@/hooks/useListParams";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { VendorStanding } from "@/types/vendorCredit";
import { moneyPaise } from "@/utils/money";
import { VendorLineBadge } from "./VendorCreditBadges";

/**
 * Every vendor's credit line. A row opens that vendor on the Vendors screen,
 * which is where the limit is edited.
 *
 * Four figures and they add up: `limit − owed − on open tickets = left`. Shown
 * as four columns rather than one "available" because the question a manager
 * actually has is WHY a vendor is out of room — a vendor that owes nothing but
 * has committed its whole line to open work needs a bigger line, and one that
 * owes it all needs to pay.
 */
export function VendorStandingTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  onRecord,
}: {
  rows?: VendorStanding[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** Open the record-a-payment form for this vendor. */
  onRecord: (row: VendorStanding) => void;
}) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);

  const columns: Column<VendorStanding>[] = [
    {
      id: "vendor",
      header: "Vendor",
      sticky: true,
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.vendorName}</div>
          {!r.isActive ? (
            <div className="text-xs text-ink-3">Paused vendor</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "limit",
      header: "Limit",
      align: "right",
      cellClassName: "tabular-nums",
      cell: (r) => moneyPaise(r.limitPaise),
    },
    {
      id: "used",
      header: "Owed",
      align: "right",
      cellClassName: "tabular-nums",
      // Negative means they paid more than they owed. Labelled rather than shown
      // as a minus, which reads as a formatting slip rather than as credit.
      cell: (r) =>
        r.usedPaise < 0 ? (
          <span className="text-ok">
            {moneyPaise(-r.usedPaise)} in credit
          </span>
        ) : (
          moneyPaise(r.usedPaise)
        ),
    },
    {
      id: "reserved",
      header: "On open tickets",
      align: "right",
      cellClassName: "tabular-nums text-ink-2",
      cell: (r) => moneyPaise(r.reservedPaise),
    },
    {
      id: "available",
      header: "Left",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(r.availablePaise),
    },
    {
      id: "record",
      header: "Record a payment",
      hideHeader: true,
      cell: (r) => (
        <div className="flex justify-end">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-input bg-surface px-2.5 text-xs font-semibold text-ink-2 transition-colors hover:border-brand-400 hover:text-ink"
            onClick={(e) => {
              // The row itself navigates to Vendors; this must not.
              e.stopPropagation();
              onRecord(r);
            }}
          >
            Record a payment
          </button>
        </div>
      ),
    },
    {
      id: "standing",
      header: "Standing",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <VendorLineBadge paused={r.paused} />
          {r.openPaymentState === "waiting" ? (
            <span className="rounded-full bg-info-bg px-2.5 py-1 text-[11px] font-semibold text-info">
              Claim waiting
            </span>
          ) : null}
          {r.pendingRequestId ? (
            <span className="rounded-full bg-info-bg px-2.5 py-1 text-[11px] font-semibold text-info">
              Asked for more
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  const filters: TypedFilterDef<VendorStanding>[] = [
    {
      id: "pausedOnly",
      label: "Standing",
      variant: "pills",
      allLabel: "All",
      options: [{ value: "true", label: "Used up" }],
      value: filterValue(params, "pausedOnly"),
      onChange: (v) => write((p) => withFilter(p, "pausedOnly", v)),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load vendor credit"
      caption="Every vendor's credit line, with what it owes, what its open tickets commit, and how much room is left"
      data={rows}
      columns={columns}
      getRowId={(r) => r.vendorId}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(`/vendors?search=${encodeURIComponent(r.vendorName)}`)}
      minWidth="56rem"
      emptyIcon={Wallet}
      emptyTitle="No vendors yet"
      emptyDescription="Add a vendor and its credit line appears here."
      filteredEmptyTitle="No vendors match"
      filteredEmptyDescription="Every vendor on this page still has room."
    />
  );
}
