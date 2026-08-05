import { Link, useNavigate } from "react-router";
import { Users } from "lucide-react";
import { DataTable, type Column, type TypedFilterDef } from "@/components/shared/DataTable";
import { BandwidthBar, CancelCount, TechAvatar, TechStatusPill } from "./BandwidthBar";
import type { Technician } from "@/types";

interface TechTableProps {
  technicians?: Technician[];
  categories: string[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

export function TechTable({
  technicians,
  categories,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: TechTableProps) {
  const navigate = useNavigate();

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
              className="hover:text-brand-400 font-medium"
            >
              {t.name}
            </Link>
            <div className="text-ink-3 font-mono text-xs">{t.id}</div>
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

  const filters: TypedFilterDef<Technician>[] = [
    {
      id: "category",
      label: "Category",
      variant: "select",
      options: categories.map((c) => ({ value: c, label: c })),
      match: (t, v) => t.cats.includes(v),
    },
    {
      id: "status",
      label: "Status",
      variant: "select",
      options: [
        { value: "Active", label: "Active" },
        { value: "Inactive", label: "Inactive" },
      ],
      match: (t, v) => t.status === v,
    },
  ];

  return (
    <DataTable
      caption="Technicians, with their categories, service pincodes, bandwidth and cancellation history"
      data={technicians}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name, ID or pincode…",
        fn: (t, q) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.pincodes.includes(q),
      }}
      filters={filters}
      toolbarActions={toolbarActions}
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
