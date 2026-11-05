import { ScrollText } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { filterValue, useParamsWriter, withFilter } from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  API_LOG_ENDPOINTS,
  API_LOG_ENDPOINT_LABELS,
  type ApiLogEntry,
} from "@/types/integration";
import { formatDateTime } from "@/utils/datetime";

/**
 * What a CRM asked for, and how it went.
 *
 * Answers a vendor's "why did my ticket not arrive?" without anybody reading
 * server files. It lists calls made with a KNOWN credential only — a call whose
 * Client ID matches none belongs to no company, so it has no row here. The page
 * says so, because the absence would otherwise read as "nothing was attempted".
 *
 * `summary` is the redacted request. It is null once 30 days have passed (the
 * row itself stays a year), and that is worded as a fact about the retention
 * rule rather than as missing data. A secret or token never appears in it.
 */
export function ApiLogTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  vendors,
  credentials,
  toolbarActions,
}: {
  rows?: ApiLogEntry[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  vendors: { value: string; label: string }[];
  credentials: { value: string; label: string }[];
  toolbarActions?: React.ReactNode;
}) {
  const write = useParamsWriter(params, onParams);

  const columns: Column<ApiLogEntry>[] = [
    {
      id: "time",
      header: "Time",
      sticky: true,
      cell: (r) => (
        <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span>
      ),
    },
    {
      id: "vendor",
      header: "Vendor",
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.vendorName}</div>
          <div className="font-mono text-[11px] break-all text-ink-3">
            {r.clientId}
          </div>
        </div>
      ),
    },
    {
      id: "endpoint",
      header: "Call",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{API_LOG_ENDPOINT_LABELS[r.endpoint] ?? r.endpoint}</span>
          {r.checkOnly ? (
            <span className="rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-semibold text-info">
              Check only
            </span>
          ) : null}
          {r.repeat ? (
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
              Repeat
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Result",
      cell: (r) => (
        <div className="leading-tight">
          <span
            className={cn(
              "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums",
              r.httpStatus < 400 ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"
            )}
          >
            {r.httpStatus}
          </span>
          {r.outcomeCode ? (
            <div className="mt-1 font-mono text-[11px] text-ink-2">
              {r.outcomeCode}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "reference",
      header: "CRM reference",
      cell: (r) =>
        r.reference ? (
          <span className="font-mono text-xs break-all">{r.reference}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      id: "details",
      header: "Request",
      cell: (r) =>
        r.summary === null ? (
          <span className="text-xs text-ink-3">
            Details removed after 30 days
          </span>
        ) : (
          // A native disclosure: keyboard-operable and announced by every
          // screen reader, with no state to keep per row.
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-brand-400">
              View details
            </summary>
            <pre className="mt-1.5 max-w-72 overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
              {JSON.stringify(r.summary, null, 2)}
            </pre>
          </details>
        ),
    },
  ];

  const filters: TypedFilterDef<ApiLogEntry>[] = [
    {
      id: "vendorId",
      label: "Vendor",
      variant: "select",
      options: vendors,
      value: filterValue(params, "vendorId"),
      onChange: (v) => write((p) => withFilter(p, "vendorId", v)),
    },
    {
      id: "credentialId",
      label: "Credential",
      variant: "select",
      options: credentials,
      value: filterValue(params, "credentialId"),
      onChange: (v) => write((p) => withFilter(p, "credentialId", v)),
    },
    {
      id: "endpoint",
      label: "Call",
      variant: "select",
      options: API_LOG_ENDPOINTS.map((e) => ({
        value: e,
        label: API_LOG_ENDPOINT_LABELS[e],
      })),
      value: filterValue(params, "endpoint"),
      onChange: (v) => write((p) => withFilter(p, "endpoint", v)),
    },
    {
      id: "outcome",
      label: "Result",
      variant: "pills",
      allLabel: "All",
      options: [
        { value: "ok", label: "Succeeded" },
        { value: "error", label: "Refused" },
      ],
      value: filterValue(params, "outcome"),
      onChange: (v) => write((p) => withFilter(p, "outcome", v)),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load the API log"
      caption="Calls from vendors' systems, with the time, vendor, call, result, CRM reference and request details"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      filters={filters}
      toolbarActions={toolbarActions}
      server={{ meta, params, onParams }}
      minWidth="62rem"
      emptyIcon={ScrollText}
      emptyTitle="No API calls yet"
      emptyDescription="When a vendor's system calls you, each call appears here."
      filteredEmptyTitle="No calls match"
      filteredEmptyDescription="Try other filters or a wider date range."
    />
  );
}
