import { ReceiptText } from "lucide-react";
import { Link } from "react-router";
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
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  CREDIT_ENTRY_KINDS,
  CREDIT_ENTRY_KIND_LABELS,
  type CreditEntry,
  type CreditEntryKind,
} from "@/types/credits";
import { formatDateTime } from "@/utils/datetime";
import { formatCredits } from "@/utils/credits";

/**
 * The statement: every credit that came in and every ticket that spent one,
 * newest first. A ticket line links to the ticket, a recharge line to the
 * recharge — the number on its own is not an explanation.
 */
export function CreditEntriesTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: {
  rows?: CreditEntry[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const write = useParamsWriter(params, onParams);
  const origin = useNavOrigin("Back to credits");

  const columns: Column<CreditEntry>[] = [
    {
      id: "at",
      header: "When",
      cellClassName: "whitespace-nowrap text-ink-2",
      cell: (e) => formatDateTime(e.at),
    },
    {
      id: "what",
      header: "What",
      cell: (e) =>
        e.kind === "ticket" && e.ticketId ? (
          <span>
            Ticket{" "}
            <Link
              to={`/tickets/${e.ticketId}`}
              state={origin}
              className="font-mono text-xs font-medium text-ink hover:underline"
            >
              {e.ticketCode ?? "—"}
            </Link>
          </span>
        ) : e.kind === "recharge" && e.rechargeId ? (
          <span>
            Recharge{" "}
            <Link
              to={`/credits/recharges/${e.rechargeId}`}
              state={origin}
              className="font-mono text-xs font-medium text-ink hover:underline"
            >
              {e.rechargeCode ?? "—"}
            </Link>
          </span>
        ) : (
          CREDIT_ENTRY_KIND_LABELS[e.kind]
        ),
    },
    {
      id: "credits",
      header: "Credits",
      align: "right",
      cell: (e) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            e.credits < 0 ? "text-ink" : "text-ok"
          )}
        >
          {e.credits > 0 ? "+" : ""}
          {formatCredits(e.credits)}
        </span>
      ),
    },
  ];

  const filters: TypedFilterDef<CreditEntry>[] = [
    {
      id: "kind",
      label: "Kind",
      variant: "pills",
      allLabel: "All",
      options: CREDIT_ENTRY_KINDS.map((k) => ({
        value: k,
        label: CREDIT_ENTRY_KIND_LABELS[k],
      })),
      value: filterValue(params, "kind"),
      onChange: (v) => write((p) => withFilter(p, "kind", v)),
      match: (e, value) => e.kind === (value as CreditEntryKind),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load the statement"
      caption="Every credit the company received and every ticket that spent credits, newest first"
      data={rows}
      columns={columns}
      getRowId={(e) => e.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search ticket or recharge code…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      minWidth="36rem"
      emptyIcon={ReceiptText}
      emptyTitle="Nothing here yet"
      emptyDescription="Credits received and tickets raised appear here."
      filteredEmptyTitle="Nothing matches"
      filteredEmptyDescription="Try a different kind, or clear the search."
    />
  );
}
