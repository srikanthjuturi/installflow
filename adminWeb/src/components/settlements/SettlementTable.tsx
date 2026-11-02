import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import {
  ALL_FILTER,
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  SETTLEMENT_REASON_LABELS,
  SETTLEMENT_STATES,
  SETTLEMENT_STATE_LABELS,
  canDecide,
  directionLabel,
  type Settlement,
  type SettlementFranchisee,
  type SettlementSide,
  type SettlementState,
} from "@/types/franchiseSettlement";
import { formatDate } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/** Static class strings — an interpolated tint is never generated. */
const STATE_CLASS: Record<SettlementState, string> = {
  awaiting: "bg-warn-bg text-warn",
  settled: "bg-ok-bg text-ok",
  declined: "bg-surface-3 text-ink-2",
};

export function SettlementBadge({ state }: { state: SettlementState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        STATE_CLASS[state]
      )}
    >
      {SETTLEMENT_STATE_LABELS[state]}
    </span>
  );
}

/**
 * The one transfers table, for both surfaces. `side` decides the wording of the
 * direction, whether the franchisee column and filter exist, and which rows
 * carry Confirm / Decline (only those waiting on the viewer's own side).
 */
export function SettlementTable({
  side,
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  franchisees,
  onConfirm,
  onDecline,
}: {
  side: SettlementSide;
  rows?: Settlement[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** Staff only — feeds the franchisee filter. */
  franchisees?: SettlementFranchisee[];
  onConfirm: (row: Settlement) => void;
  onDecline: (row: Settlement) => void;
}) {
  const write = useParamsWriter(params, onParams);
  const staff = side === "staff";

  const columns: Column<Settlement>[] = [
    {
      id: "code",
      header: "Reference",
      cellClassName: "font-mono text-xs",
      cell: (r) => r.code,
    },
    ...(staff
      ? [
          {
            id: "franchisee",
            header: "Franchisee",
            cell: (r: Settlement) => (
              <span className="font-medium">{r.franchiseeName}</span>
            ),
          } satisfies Column<Settlement>,
        ]
      : []),
    {
      id: "direction",
      header: "Direction",
      cell: (r) => directionLabel(r.direction, side),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(r.amountPaise),
    },
    {
      id: "reason",
      header: "For",
      cell: (r) => (
        <div className="leading-tight">
          <div>{SETTLEMENT_REASON_LABELS[r.reason]}</div>
          {r.note ? (
            <div className="max-w-56 truncate text-xs text-ink-3" title={r.note}>
              {r.note}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "date",
      header: "Sent on",
      cell: (r) => (
        <div className="leading-tight">
          <div>{formatDate(r.transferredOn)}</div>
          {r.utr ? (
            <div className="font-mono text-xs text-ink-3">{r.utr}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "state",
      header: "Status",
      cell: (r) => (
        <div className="leading-tight">
          <SettlementBadge state={r.state} />
          {r.state === "declined" && r.declineReason ? (
            <div
              className="mt-1 max-w-48 truncate text-xs text-ink-3"
              title={r.declineReason}
            >
              {r.declineReason}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "proof",
      header: "Proof",
      cell: (r) =>
        r.proofUrl ? (
          <a
            href={r.proofUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-500 hover:underline"
          >
            View
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only"> screenshot for {r.code}</span>
          </a>
        ) : (
          "—"
        ),
    },
    {
      id: "document",
      header: "Document",
      cellClassName: "font-mono text-xs text-ink-2",
      cell: (r) => r.documentNumber ?? "—",
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) =>
        canDecide(r, side) ? (
          <div className="flex justify-end gap-1.5">
            <Button type="button" size="sm" onClick={() => onConfirm(r)}>
              Confirm
              <span className="sr-only"> {r.code} arrived</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onDecline(r)}
            >
              Decline
              <span className="sr-only"> {r.code}</span>
            </Button>
          </div>
        ) : null,
    },
  ];

  const filters: TypedFilterDef<Settlement>[] = [
    {
      id: "state",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: SETTLEMENT_STATES.map((s) => ({
        value: s,
        label: SETTLEMENT_STATE_LABELS[s],
      })),
      value: filterValue(params, "state"),
      onChange: (v) => write((p) => withFilter(p, "state", v)),
      match: (r, value) => r.state === value,
    },
    {
      id: "direction",
      label: "Direction",
      variant: "select",
      allValue: "All",
      options: [
        {
          value: "company_to_franchisee",
          label: directionLabel("company_to_franchisee", side),
        },
        {
          value: "franchisee_to_company",
          label: directionLabel("franchisee_to_company", side),
        },
        { value: ALL_FILTER, label: "All" },
      ],
      value: filterValue(params, "direction"),
      onChange: (v) => write((p) => withFilter(p, "direction", v)),
      match: (r, value) => r.direction === value,
    },
    ...(staff
      ? [
          {
            id: "franchiseeId",
            label: "Franchisee",
            variant: "select",
            allValue: "All",
            options: [
              ...(franchisees ?? []).map((f) => ({ value: f.id, label: f.name })),
              { value: ALL_FILTER, label: "All" },
            ],
            value: filterValue(params, "franchiseeId"),
            onChange: (v: string) => write((p) => withFilter(p, "franchiseeId", v)),
            match: (r: Settlement, value: string) => r.franchiseeId === value,
          } satisfies TypedFilterDef<Settlement>,
        ]
      : []),
  ];

  return (
    <DataTable
      errorTitle="Couldn't load transfers"
      caption="Money sent between the company and its franchisees, with the amount, the proof and where each stands"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: staff ? "Search reference, franchisee or UTR…" : "Search reference or UTR…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      minWidth={staff ? "70rem" : "62rem"}
      emptyIcon={ArrowLeftRight}
      emptyTitle="No transfers yet"
      emptyDescription={
        staff
          ? "Record money you sent a franchisee, or wait for one to record what it sent you."
          : "Record money you sent the company, or wait for the company to record what it sent you."
      }
      filteredEmptyTitle="No transfers match"
      filteredEmptyDescription="Try a different status, direction or franchisee."
    />
  );
}
