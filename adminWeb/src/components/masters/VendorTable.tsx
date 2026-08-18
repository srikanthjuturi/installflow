import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { Vendor } from "@/types/vendor";
import { VENDOR_STATUSES } from "./vendorSchema";

/** Static strings — an interpolated `text-${status}` is never generated. */
const STATUS_CLASS: Record<"Active" | "Paused", string> = {
  Active: "text-ok",
  Paused: "text-warn",
};

/** The prototype's 32px squared monogram. */
function VendorMonogram({ name }: { name: string }) {
  return (
    <div
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-3 text-xs font-semibold text-ink-2"
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

interface VendorTableProps {
  /** Exactly the rows the server returned for `params` — one page of them. */
  vendors?: Vendor[];
  /** The envelope's pagination block. Absent on the first load. */
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Presentation only — the server enforces `vendors.edit` (hard rule 8). */
  canEdit: boolean;
  onEdit: (vendor: Vendor) => void;
  onDelete: (vendor: Vendor) => void;
  toolbarActions?: React.ReactNode;
}

export function VendorTable({
  vendors,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  canEdit,
  onEdit,
  onDelete,
  toolbarActions,
}: VendorTableProps) {
  // Search and the status filter are query parameters, so each control writes
  // through here instead of narrowing rows in the browser.
  const write = useParamsWriter(params, onParams);

  /*
   * No `sortValue` on the columns the server orders by, on purpose: DataTable's
   * server mode wires only page and page size to `server.onParams`, so a header
   * button would render an arrow that reorders nothing and announce an
   * `aria-sort` that is not true. Restore them when shared/DataTable reports
   * sort through `onParams`.
   */
  const columns: Column<Vendor>[] = [
    {
      id: "name",
      header: "Vendor",
      cell: (v) => (
        <div className="flex items-center gap-2.5">
          <VendorMonogram name={v.name} />
          <span className="font-medium">{v.name}</span>
        </div>
      ),
    },
    {
      id: "gstNumber",
      header: "GSTIN",
      cellClassName: "font-mono text-xs text-ink-2",
      cell: (v) => v.gstNumber,
    },
    {
      id: "contact",
      header: "Contact",
      cell: (v) => (
        <div className="leading-tight">
          <div>{v.contactPerson}</div>
          <div className="text-xs text-ink-3 tabular-nums">{v.phone}</div>
        </div>
      ),
    },
    {
      id: "city",
      header: "City",
      cell: (v) => (
        <div className="leading-tight">
          <div>{v.city}</div>
          <div className="text-xs text-ink-3">{v.state}</div>
        </div>
      ),
    },
    {
      id: "models",
      header: "Models branded",
      cellClassName: "tabular-nums",
      // A real COUNT from the API. Zero is a fact worth showing, not a gap.
      cell: (v) => v.modelCount,
    },
    {
      id: "status",
      header: "Status",
      cell: (v) => {
        const label = v.isActive ? "Active" : "Paused";
        return (
          // Never colour alone — the status word is always present.
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
      cell: (v) =>
        canEdit ? (
          <div className="flex items-center gap-3">
            {/* Buttons, not links: they open dialogs rather than navigating. */}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => onEdit(v)}
            >
              Edit
              <span className="sr-only"> {v.name}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-danger"
              onClick={() => onDelete(v)}
            >
              Remove
              <span className="sr-only"> {v.name}</span>
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
  const filters: TypedFilterDef<Vendor>[] = [
    {
      id: "status",
      label: "Status",
      variant: "select",
      options: VENDOR_STATUSES.map((s) => ({
        // The API takes lowercase; the label stays the word people read.
        value: s.toLowerCase(),
        label: s,
      })),
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
      match: (v, value) => (v.isActive ? "active" : "paused") === value,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load vendors"
      caption="Vendors, with their GSTIN, contact person, city, how many product models carry the brand, and status"
      data={vendors}
      columns={columns}
      getRowId={(v) => v.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name, GSTIN, contact or city…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      toolbarActions={toolbarActions}
      minWidth="56rem"
      emptyTitle="No vendors yet"
      emptyDescription="Add the companies whose products you install. Each one becomes a brand you can pick when adding a product model."
      filteredEmptyTitle="No vendors match those filters"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
