import { IndianRupee } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { filterValue, useParamsWriter, withFilter } from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { relativeTime } from "@/lib/relativeTime";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  VENDOR_PAYMENT_STATES,
  VENDOR_PAYMENT_STATE_LABELS,
  type VendorPayment,
  type VendorPaymentState,
} from "@/types/vendorCredit";
import { moneyPaise } from "@/utils/money";
import { VendorPaymentBadge } from "./VendorCreditBadges";

/**
 * Vendor payments — the ops queue, or one vendor's own history.
 *
 * `to` decides which: ops rows open the decision page, a vendor's own open the
 * QR. One table because the columns are the same and the audiences read the same
 * facts; only the destination and the vendor column differ.
 */
export function VendorPaymentTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  to,
  showVendor = false,
  backLabel,
}: {
  rows?: VendorPayment[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** Where a row goes. */
  to: (row: VendorPayment) => string;
  showVendor?: boolean;
  backLabel: string;
}) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);
  const origin = useNavOrigin(backLabel);

  const columns: Column<VendorPayment>[] = [
    ...(showVendor
      ? [
          {
            id: "vendor",
            header: "Vendor",
            sticky: true,
            cell: (r: VendorPayment) => (
              <span className="font-medium">{r.vendorName ?? "—"}</span>
            ),
          } satisfies Column<VendorPayment>,
        ]
      : []),
    {
      id: "code",
      header: "Reference",
      cellClassName: "font-mono text-xs",
      cell: (r) => r.code,
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(r.amountPaise),
    },
    {
      id: "requested",
      header: "Asked",
      cell: (r) => (
        <div className="leading-tight">
          <div>{relativeTime(r.createdAt)}</div>
          {r.requestedByLabel ? (
            <div className="text-xs text-ink-3">{r.requestedByLabel}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "how",
      header: "How",
      cell: (r) => (
        <div className="leading-tight">
          {/* UPI for the QR flow, the recorded method otherwise. The two must
              never read alike: one is the vendor's word plus ours, the other is
              ours alone. */}
          <div>{r.source === "staff" ? (r.method ?? "Recorded") : "UPI"}</div>
          {r.source === "staff" ? (
            <div className="text-xs text-ink-3">recorded by us</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "utr",
      header: "Reference",
      cellClassName: "font-mono text-xs text-ink-2",
      // An em-dash, not a blank: nothing has been claimed yet, or cash carried
      // no reference. Both are facts.
      cell: (r) => r.utr ?? "—",
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <VendorPaymentBadge state={r.state} />,
    },
  ];

  const filters: TypedFilterDef<VendorPayment>[] = [
    {
      id: "state",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: VENDOR_PAYMENT_STATES.map((s) => ({
        value: s,
        label: VENDOR_PAYMENT_STATE_LABELS[s],
      })),
      value: filterValue(params, "state"),
      onChange: (v) => write((p) => withFilter(p, "state", v)),
      match: (r, value) => r.state === (value as VendorPaymentState),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load payments"
      caption="Vendor payments, with the amount, when each was asked for, its bank reference and where it stands"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(to(r), { state: origin })}
      minWidth={showVendor ? "40rem" : "34rem"}
      emptyIcon={IndianRupee}
      emptyTitle="No payments yet"
      emptyDescription="Payments appear here once a vendor starts one."
      filteredEmptyTitle="No payments match"
      filteredEmptyDescription="Try a different status."
    />
  );
}
