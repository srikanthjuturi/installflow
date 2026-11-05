import { useMemo } from "react";
import { Link } from "react-router";
import { ExternalLink, ReceiptText } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { ALL_FILTER } from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import type { TransactionPatch } from "@/hooks/useTransactionFilters";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  PARTY_KINDS,
  PARTY_KIND_LABELS,
  SURFACE_CAPS,
  amountColumns,
  type PartyOption,
  type TransactionDocument,
  type TransactionSurface,
} from "@/types/transaction";
import { formatDate } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import { DocTypeBadge, EmailStatusBadge } from "./badges";
import type { TransactionUrlState } from "@/hooks/useTransactionFilters";
import { ticketPathFor } from "./surface";

/**
 * The one documents table, for all four surfaces. What differs is read off
 * `SURFACE_CAPS`: the company column and filter (superadmin), the party filters
 * (hidden for a vendor, which is always itself) and the email-status column
 * (company and platform only).
 *
 * Debit and credit are separate columns and the server's `effect` decides which
 * a document fills - never the document's type.
 */
export function TransactionTable({
  surface,
  state,
  patch,
  rows,
  meta,
  isLoading,
  isFetching,
  error,
  onRetry,
  parties,
  companies,
  onOpen,
}: {
  surface: TransactionSurface;
  state: TransactionUrlState;
  patch: (changes: TransactionPatch) => void;
  rows?: TransactionDocument[];
  meta?: PaginationMeta;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  parties?: PartyOption[];
  companies?: { id: string; name: string }[];
  onOpen: (row: TransactionDocument) => void;
}) {
  const caps = SURFACE_CAPS[surface];
  const origin = useNavOrigin("Back to transactions");

  const columns: Column<TransactionDocument>[] = [
    {
      id: "number",
      header: "Number",
      cellClassName: "font-mono text-xs whitespace-nowrap",
      cell: (r) => r.number,
    },
    {
      id: "type",
      header: "Type",
      cell: (r) => <DocTypeBadge type={r.docType} />,
    },
    ...(caps.companyColumn
      ? [
          {
            id: "company",
            header: "Company",
            cell: (r: TransactionDocument) => r.companyName,
          } satisfies Column<TransactionDocument>,
        ]
      : []),
    {
      id: "party",
      header: "Party",
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.partyLabel}</div>
          <div className="text-xs text-ink-3">{PARTY_KIND_LABELS[r.partyKind]}</div>
        </div>
      ),
    },
    {
      id: "details",
      header: "Details",
      cell: (r) => {
        const to = r.ticketId ? ticketPathFor(surface, r.ticketId) : null;
        return (
          <div className="max-w-64 leading-tight">
            <div className="truncate" title={r.description}>
              {r.description}
            </div>
            {r.ticketCode ? (
              to ? (
                <Link
                  to={to}
                  state={origin}
                  // The row opens the drawer; the code goes to the ticket.
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-xs text-brand-500 hover:underline"
                >
                  {r.ticketCode}
                </Link>
              ) : (
                <span className="font-mono text-xs text-ink-3">{r.ticketCode}</span>
              )
            ) : null}
          </div>
        );
      },
    },
    {
      id: "debit",
      header: "Debit",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(amountColumns(r).debitPaise),
    },
    {
      id: "credit",
      header: "Credit",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(amountColumns(r).creditPaise),
    },
    {
      id: "date",
      header: "Date",
      cellClassName: "whitespace-nowrap",
      cell: (r) => formatDate(r.issuedAt),
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
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-500 hover:underline"
          >
            View
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only"> proof for {r.number}</span>
          </a>
        ) : (
          "—"
        ),
    },
    ...(caps.email
      ? [
          {
            id: "email",
            header: "Email",
            cell: (r: TransactionDocument) => (
              <EmailStatusBadge status={r.emailStatus} />
            ),
          } satisfies Column<TransactionDocument>,
        ]
      : []),
  ];

  const partyOptions = useMemo(
    () => [
      ...(parties ?? [])
        .filter((p) => p.partyId !== null)
        .map((p) => ({
          value: p.partyId as string,
          label: p.label,
          hint: PARTY_KIND_LABELS[p.partyKind],
        })),
      { value: ALL_FILTER, label: "All" },
    ],
    [parties]
  );

  const filters: TypedFilterDef<TransactionDocument>[] = [
    {
      id: "docType",
      label: "Type",
      variant: "select",
      allValue: ALL_FILTER,
      options: [
        ...DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] })),
        { value: ALL_FILTER, label: "All" },
      ],
      value: state.docType ?? ALL_FILTER,
      onChange: (v) => patch({ type: v === ALL_FILTER ? undefined : v }),
    },
    ...(caps.partyFilter
      ? [
          {
            id: "partyKind",
            label: "Party kind",
            variant: "select",
            allValue: ALL_FILTER,
            options: [
              ...PARTY_KINDS.map((k) => ({ value: k, label: PARTY_KIND_LABELS[k] })),
              { value: ALL_FILTER, label: "All" },
            ],
            value: state.partyKind ?? ALL_FILTER,
            // A party of another kind no longer fits the filter.
            onChange: (v: string) =>
              patch({ kind: v === ALL_FILTER ? undefined : v, party: undefined }),
          } satisfies TypedFilterDef<TransactionDocument>,
          {
            id: "partyId",
            label: "Party",
            variant: "combobox",
            allValue: ALL_FILTER,
            options: partyOptions,
            value: state.partyId ?? ALL_FILTER,
            onChange: (v: string) => patch({ party: v === ALL_FILTER ? undefined : v }),
          } satisfies TypedFilterDef<TransactionDocument>,
        ]
      : []),
    ...(caps.companyFilter
      ? [
          {
            id: "companyId",
            label: "Company",
            variant: "select",
            allValue: ALL_FILTER,
            options: [
              ...(companies ?? []).map((c) => ({ value: c.id, label: c.name })),
              { value: ALL_FILTER, label: "All" },
            ],
            value: state.companyId ?? ALL_FILTER,
            // A party belongs to one company, so changing company drops it.
            onChange: (v: string) =>
              patch({ company: v === ALL_FILTER ? undefined : v, party: undefined }),
          } satisfies TypedFilterDef<TransactionDocument>,
        ]
      : []),
  ];

  const params: ListParams = { page: state.page, limit: state.limit };

  return (
    <DataTable
      errorTitle="Couldn't load documents"
      caption="Numbered documents with their party, amount, date and proof"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      onRowClick={onOpen}
      search={{
        placeholder: "Search number, party, details or reference…",
        value: state.search,
        onChange: (v) => patch({ q: v.trim() || undefined }),
      }}
      filters={filters}
      server={{
        meta,
        params,
        onParams: (next) =>
          patch({
            page: next.page ? String(next.page) : undefined,
            limit: next.limit ? String(next.limit) : undefined,
          }),
      }}
      minWidth={caps.email ? "76rem" : "64rem"}
      emptyIcon={ReceiptText}
      emptyTitle="No documents in this period"
      emptyDescription="Documents are numbered and listed here as tickets close and money moves."
      filteredEmptyTitle="No documents match"
      filteredEmptyDescription="Try a different period, type, party or search."
    />
  );
}
