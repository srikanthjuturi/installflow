import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import { PARTNER_STATUSES } from "./partnerSchema";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { Partner, PartnerKind, PartnerStatus } from "@/types";

/** Static strings — an interpolated `text-${status}` is never generated. */
const STATUS_CLASS: Record<PartnerStatus, string> = {
  Invited: "text-warn",
  Active: "text-ok",
  Inactive: "text-ink-3",
};

/** The one place a partner's appointment date is rendered. */
function AppointedOn({ iso }: { iso: string }) {
  return (
    <time dateTime={iso}>
      {new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })}
    </time>
  );
}

interface PartnerTableProps {
  kind: PartnerKind;
  /** Exactly the rows the server returned for `params` — one page of them. */
  partners?: Partner[];
  /** The envelope's pagination block. Absent on the first load. */
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

/**
 * One table for both partner kinds — they hold the same fields, so a second
 * copy would only differ in its copy. The kind supplies that.
 */
export function PartnerTable({
  kind,
  partners,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: PartnerTableProps) {
  const write = useParamsWriter(params, onParams);
  const label = kind === "Freelancer" ? "freelancer" : "franchise";
  const plural = kind === "Freelancer" ? "freelancers" : "franchises";

  const columns: Column<Partner>[] = [
    {
      id: "id",
      header: kind,
      cell: (p) => <span className="font-mono text-xs">{p.id}</span>,
    },
    {
      id: "phone",
      header: "Mobile number",
      cell: (p) => <span className="font-medium">{p.phone}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        // Never colour alone — the status word is always present.
        <span
          className={cn(
            "inline-flex items-center gap-1.25 text-xs font-semibold",
            STATUS_CLASS[p.status]
          )}
        >
          <span aria-hidden className="size-1.75 rounded-full bg-current" />
          {p.status}
        </span>
      ),
    },
    {
      id: "appointedBy",
      header: "Appointed by",
      cell: (p) => p.appointedBy,
    },
    {
      id: "appointedOn",
      header: "Appointed on",
      cell: (p) => <AppointedOn iso={p.appointedOn} />,
    },
  ];

  /*
   * Controlled against the query string. `match` is part of the filter
   * contract but is never called in server mode — the rows arrive already
   * narrowed — so it states what the filter means rather than re-implementing
   * it. Sorting is deliberately not declared: `DataTable`'s server mode wires
   * only page and page size to `onParams`, so a `sortValue` here would render
   * arrows that reorder nothing (same note as `VendorTable`).
   */
  const filters: TypedFilterDef<Partner>[] = [
    {
      id: "status",
      label: "Status",
      variant: "pills",
      options: PARTNER_STATUSES.map((s) => ({ value: s, label: s })),
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
      match: (p, value) => p.status === value,
    },
  ];

  return (
    <DataTable
      errorTitle={`Couldn't load ${plural}`}
      caption={`Appointed ${plural}, with their mobile number, status and who appointed them`}
      data={partners}
      columns={columns}
      getRowId={(p) => p.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by mobile number…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      toolbarActions={toolbarActions}
      minWidth="38rem"
      emptyTitle={`No ${plural} yet`}
      emptyDescription={`Appoint one and the invite goes to their mobile number. Until the ${label} completes it, the record stays Invited.`}
      filteredEmptyTitle={`No ${plural} match those filters`}
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
