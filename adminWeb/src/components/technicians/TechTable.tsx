import { Link, useNavigate } from "react-router";
import { Users } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import {
  BandwidthBar,
  CancelCount,
  TechAvatar,
  TechStatusPill,
} from "./BandwidthBar";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { Technician } from "@/types";

const ALL = "All";

interface TechTableProps {
  /** One page of rows, already searched, filtered and sorted by the server. */
  technicians?: Technician[];
  meta?: PaginationMeta;
  params: ListParams;
  /** Merges what it is given into the query — see `applyParams` on the page. */
  onParams: (next: ListParams) => void;
  categories: string[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

export function TechTable({
  technicians,
  meta,
  params,
  onParams,
  categories,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: TechTableProps) {
  const navigate = useNavigate();

  // Narrowing the result set always returns to page 1 — page 4 of the old
  // result set is rarely a page of the new one, and never the same rows.
  //
  // Sent as a change, not a whole query: "Clear filters" resets the search and
  // both filters in one tick, and three full objects all built from the same
  // render's `params` would undo each other.
  const setSearch = (search: string) => onParams({ page: 1, search });

  const setFilter = (id: string, value: string) =>
    onParams({ page: 1, filters: { [id]: value } });

  const columns: Column<Technician>[] = [
    {
      id: "name",
      header: "Technician",
      sortValue: (t) => t.name,
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <TechAvatar name={t.name} />
          <div className="min-w-0">
            {/* A real link so the row is keyboard reachable and opens in a
                new tab — the row click is a convenience on top. */}
            <Link
              to={`/technicians/${t.id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium hover:text-brand-400"
            >
              {t.name}
            </Link>
            <div className="font-mono text-xs text-ink-3">{t.id}</div>
          </div>
        </div>
      ),
    },
    { id: "cats", header: "Categories", cell: (t) => t.cats.join(", ") },
    {
      id: "pincodes",
      header: "Pincodes",
      cell: (t) => <span className="font-mono text-xs">{t.pincodes}</span>,
    },
    {
      id: "bandwidth",
      header: "Bandwidth",
      // Sorts on how full they are, not the raw cap — 5/5 is busier than 2/6.
      sortValue: (t) => (t.bwTotal === 0 ? 0 : t.bwUsed / t.bwTotal),
      cell: (t) => <BandwidthBar used={t.bwUsed} total={t.bwTotal} />,
    },
    {
      id: "rating",
      header: "Rating",
      align: "right",
      sortValue: (t) => t.rating,
      cell: (t) => (
        <span className="tabular-nums">
          {t.rating} <span aria-hidden>★</span>
        </span>
      ),
    },
    {
      id: "jobs",
      header: "Jobs",
      align: "right",
      sortValue: (t) => t.jobs,
      cell: (t) => <span className="tabular-nums">{t.jobs}</span>,
    },
    {
      id: "cancels",
      header: "Cancels",
      align: "right",
      sortValue: (t) => t.cancels,
      cell: (t) => <CancelCount cancels={t.cancels} />,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (t) => t.status,
      cell: (t) => <TechStatusPill status={t.status} />,
    },
  ];

  /**
   * The defs still own the label and the options — the toolbar renders from
   * them. What they no longer own is the matching: the value goes into
   * `params.filters` and the server narrows the result set, so `match` is
   * never called in server mode.
   */
  const filters: TypedFilterDef<Technician>[] = [
    {
      id: "category",
      label: "Category",
      variant: "select",
      options: categories.map((c) => ({ value: c, label: c })),
      value: params.filters?.category ?? ALL,
      onChange: (v) => setFilter("category", v),
      match: () => true,
    },
    {
      id: "status",
      label: "Status",
      variant: "select",
      options: [
        { value: "Active", label: "Active" },
        { value: "Inactive", label: "Inactive" },
      ],
      value: params.filters?.status ?? ALL,
      onChange: (v) => setFilter("status", v),
      match: () => true,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load technicians"
      caption="Technicians, with their categories, service pincodes, bandwidth and cancellation history"
      data={technicians}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name, ID or pincode…",
        // Controlled, and matched server-side across name, id and pincodes.
        value: params.search ?? "",
        onChange: setSearch,
      }}
      filters={filters}
      toolbarActions={toolbarActions}
      server={{ meta, params, onParams }}
      defaultSort={{ columnId: "name", dir: "asc" }}
      onRowClick={(t) => navigate(`/technicians/${t.id}`)}
      minWidth="64rem"
      emptyIcon={Users}
      emptyTitle="No technicians yet"
      emptyDescription="Add a technician to start dispatching jobs in their categories and pincodes."
      filteredEmptyTitle="No technicians match those filters"
      filteredEmptyDescription="Try a different category or status, or clear the search."
    />
  );
}
