import { Download } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { TechStatusPill } from "@/components/technicians/BandwidthBar";
import { useParamsWriter, withSearch } from "@/hooks/useListParams";
import { StatementMonthPicker } from "./StatementMonthPicker";
import type { Technician } from "@/types/technician";
import type { ListParams, PaginationMeta } from "@/types/api";

interface EmployeeStatementTableProps {
  rows?: Technician[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  /** `2026-09` — the month every row's download asks for. */
  month: string;
  onMonth: (value: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** The technician whose CSV is in flight — that row alone shows a spinner. */
  downloadingId?: string | null;
  onDownload: (t: Technician) => void;
  /**
   * Shown under the empty copy — statements has "Go to Technicians", which
   * changes a technician's Type, the one remedy the empty state names.
   */
  emptyAction?: React.ReactNode;
}

/**
 * Employees and their monthly statement (§5.5) — `TechTable`'s columns,
 * trimmed to what payroll needs: who, where their phone rings, where they
 * stand, and the one action, download.
 *
 * It is not `TechTable`: that table is edit-and-assign furniture (actions per
 * lifecycle stage, a coverage column, job counters), none of which applies to
 * a list whose only verb is downloading a CSV. Sharing the STATUS pill
 * (`TechStatusPill`) and the avatar treatment keeps the two tables recognising
 * each other; sharing a component would not.
 */
export function EmployeeStatementTable({
  rows,
  meta,
  params,
  onParams,
  month,
  onMonth,
  isLoading,
  isFetching,
  error,
  onRetry,
  downloadingId,
  onDownload,
  emptyAction,
}: EmployeeStatementTableProps) {
  const write = useParamsWriter(params, onParams);

  const columns: Column<Technician>[] = [
    {
      id: "employee",
      header: "Employee",
      // Avatar over name over monogram code — the same first-column treatment
      // `TechTable` renders, so the two lists read as the same people.
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar
            name={t.name}
            src={t.profileImageUrl}
            className="size-8.5 text-xs"
          />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">{t.name}</div>
            <div className="font-mono text-xs text-ink-3">{t.code}</div>
          </div>
        </div>
      ),
    },
    {
      id: "phone",
      header: "Mobile",
      cellClassName: "tabular-nums",
      cell: (t) => t.phone,
    },
    { id: "status", header: "Status", cell: (t) => <TechStatusPill status={t.status} /> },
    {
      id: "download",
      header: "",
      align: "right",
      cell: (t) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          // One at a time, stated on the button rather than left implicit:
          // the month picker sits beside it and a second click mid-flight
          // would silently swap the file the reader is waiting for.
          disabled={downloadingId !== null}
          onClick={() => onDownload(t)}
        >
          {/* The busy state over the row acted on, not a global one — two
              people on screen download one after another without either
              spinner lying about which move is under way. */}
          {downloadingId === t.id ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <Download data-icon="inline-start" aria-hidden />
          )}
          Download CSV
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load employees"
      caption="Employees and their monthly statement"
      data={rows}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search name…",
        value: params.search ?? "",
        // `withSearch` also sends the list back to page 1, as everywhere.
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      server={{ meta, params, onParams }}
      minWidth="44rem"
      emptyIcon={Download}
      emptyTitle="No employees yet"
      emptyDescription="Technicians whose Type is Employee appear here. Change a technician's Type on their profile."
      emptyAction={emptyAction}
      filteredEmptyTitle="No employees match that search"
      filteredEmptyDescription="Try a different name."
      toolbarActions={<StatementMonthPicker value={month} onChange={onMonth} />}
    />
  );
}