import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import type { ImportRow } from "@/types";

const columns: Column<ImportRow>[] = [
  {
    id: "row",
    header: "Row",
    sortValue: (r) => r.row,
    cellClassName: "text-ink-3 font-mono text-xs",
    cell: (r) => `#${r.row}`,
  },
  {
    id: "customer",
    header: "Customer",
    sortValue: (r) => r.customer,
    cell: (r) => r.customer || <span className="text-ink-3">—</span>,
  },
  {
    id: "pincode",
    header: "Pincode",
    cellClassName: "font-mono text-xs",
    cell: (r) => r.pincode,
  },
  {
    id: "mobile",
    header: "Mobile",
    cellClassName: "font-mono text-xs",
    cell: (r) => r.mobile,
  },
  {
    id: "result",
    header: "Result",
    sortValue: (r) => r.result,
    cell: (r) => {
      const failed = r.result === "Rejected";
      const Icon = failed ? XCircle : CheckCircle2;
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-semibold",
            failed ? "text-danger" : "text-ok"
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {r.result}
        </span>
      );
    },
  },
  {
    id: "reason",
    header: "Reason",
    cell: (r) => (
      <span
        className={cn(
          "text-xs",
          r.result === "Rejected" ? "text-danger" : "text-ink-3"
        )}
      >
        {r.reason}
      </span>
    ),
  },
];

const filters: TypedFilterDef<ImportRow>[] = [
  {
    id: "result",
    label: "Result",
    variant: "pills",
    options: [
      { value: "All", label: "All" },
      { value: "Passed", label: "Passed" },
      { value: "Rejected", label: "Rejected" },
    ],
    match: (r, v) => r.result === v,
  },
];

export function ValidationTable({
  rows,
  isLoading,
}: {
  rows?: ImportRow[];
  isLoading: boolean;
}) {
  return (
    <DataTable
      caption="Every row of the uploaded file, with its validation result and the reason it was rejected"
      data={rows}
      columns={columns}
      getRowId={(r) => String(r.row)}
      isLoading={isLoading}
      filters={filters}
      defaultSort={{ columnId: "row", dir: "asc" }}
      // Tint the failed row, but never rely on it — the icon and the word
      // "Rejected" carry the verdict on their own.
      rowClassName={(r) =>
        r.result === "Rejected" ? "bg-danger-bg/40" : undefined
      }
      minWidth="45rem"
      emptyTitle="No rows in this import"
      emptyDescription="The file had no data rows to validate."
      filteredEmptyTitle="No rows with that result"
      filteredEmptyDescription="Try the other result, or show all rows."
    />
  );
}
