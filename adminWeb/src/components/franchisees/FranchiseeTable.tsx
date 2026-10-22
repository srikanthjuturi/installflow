import { Link, useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { FranchiseeBadges } from "./FranchiseeBadges";
import { Button } from "@/components/ui/button";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { Franchisee } from "@/types/franchisee";

/** Static strings — an interpolated `text-${status}` is never generated. */
const STATUS_CLASS: Record<"Active" | "Inactive", string> = {
  Active: "text-ok",
  Inactive: "text-ink-3",
};

/**
 * The console's Franchisees list, in server mode — exactly the rows `params`
 * asked for, one page of them.
 *
 * Mirrors `masters/VendorTable.tsx`. A franchisee row is the ONE place that
 * answers "who runs these pincodes" for the whole console, which is why its
 * first column is the name and code, not a status chip.
 */
export function FranchiseeTable({
  franchisees,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  canManage,
  onEdit,
  onPincodes,
  toolbarActions,
}: {
  /** Exactly the rows the server returned for `params` — one page of them. */
  franchisees?: Franchisee[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Presentation only — the server enforces `franchisees.manage` (hard rule 8). */
  canManage: boolean;
  onEdit: (franchisee: Franchisee) => void;
  onPincodes: (franchisee: Franchisee) => void;
  toolbarActions?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);
  const openDetail = useNavOrigin("Back to franchisees");

  function toDetail(f: Franchisee) {
    void navigate(`/franchisees/${f.id}`, { state: openDetail });
  }

  const columns: Column<Franchisee>[] = [
    {
      id: "name",
      header: "Franchisee",
      cell: (f) => (
        <div className="leading-tight">
          <Link
            // The link and the row go the same place; the link is for the
            // keyboard and middle-click, the row click for the mouse.
            to={`/franchisees/${f.id}`}
            state={openDetail}
            className="font-medium text-brand-500 hover:underline"
          >
            {f.name}
          </Link>
          <div className="font-mono text-xs text-ink-3">{f.code}</div>
        </div>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      cell: (f) => <FranchiseeBadges kind={f.kind} isHome={f.isHome} />,
    },
    {
      id: "pincodes",
      header: "Pincodes",
      cellClassName: "tabular-nums",
      cell: (f) => (
        <div className="leading-tight">
          {/* A real COUNT for both shapes. The home owns everything unclaimed —
              a number that no range spells out — which the hint says in place
              of a count that would be wrong an hour after it was stamped. */}
          <div>{f.isHome ? "All unclaimed" : f.pincodeCount.toLocaleString()}</div>
        </div>
      ),
    },
    {
      id: "technicians",
      header: "Technicians",
      cellClassName: "tabular-nums",
      cell: (f) => f.technicianCount,
    },
    {
      id: "admins",
      header: "Admins",
      cellClassName: "tabular-nums",
      cell: (f) => f.adminCount,
    },
    {
      id: "status",
      header: "Status",
      cell: (f) => {
        const label = f.isActive ? "Active" : "Inactive";
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
      cell: (f) =>
        canManage ? (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => onEdit(f)}
            >
              Edit
              <span className="sr-only"> {f.name}</span>
            </Button>
            {/* The home has no Pincodes action: editing its ranges is what the
                OTHER pages' dialogs do — its own are immutably "the rest". */}
            {!f.isHome ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs font-semibold text-brand-400"
                onClick={() => onPincodes(f)}
              >
                Pincodes
                <span className="sr-only"> for {f.name}</span>
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  /*
   * Controlled against the query string. Server mode never calls `match` — the
   * rows arrive already narrowed — but it stays as the statement of what the
   * filter means.
   */
  const filters: TypedFilterDef<Franchisee>[] = [
    {
      id: "kind",
      label: "Kind",
      variant: "select",
      options: [
        { value: "internal", label: "Internal" },
        { value: "external", label: "External" },
      ],
      value: filterValue(params, "kind"),
      onChange: (v) => write((p) => withFilter(p, "kind", v)),
      match: (f, value) => f.kind === value,
    },
    {
      id: "status",
      label: "Status",
      variant: "select",
      options: [
        // The API takes lowercase (`status`); the label stays the word.
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
      match: (f, value) => (f.isActive ? "active" : "inactive") === value,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load franchisees"
      caption="Franchisees with their kind, pincodes, technicians, admins and status"
      data={franchisees}
      columns={columns}
      getRowId={(f) => f.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name or code",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      toolbarActions={toolbarActions}
      onRowClick={toDetail}
      emptyTitle="No franchisees yet"
      emptyDescription="Add one and give it the pincodes it will run."
      filteredEmptyTitle="No franchisees match those filters"
      filteredEmptyDescription="Try a different kind or status, or clear the search."
    />
  );
}