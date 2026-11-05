import { KeyRound } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { formatDateTime } from "@/utils/datetime";
import type { ApiCredential } from "@/types/integration";
import { CredentialStatusBadge } from "./CredentialBadges";

/**
 * A vendor's CRM credentials.
 *
 * **There is no secret column and there must never be one.** The list shape
 * (`ApiCredential`) carries no secret at all — it is shown once, in the dialog
 * that follows creating or replacing a credential, and the server keeps only a
 * hash.
 *
 * A revoked row offers no action: Replace would hand out a fresh working
 * credential from a dead one, and revoking twice does nothing. Replace is
 * labelled for what it does — a NEW credential, with the old one left running
 * until it is revoked — because "replace" alone reads as a swap.
 */
export function ApiCredentialTable({
  rows,
  isLoading,
  error,
  onRetry,
  onReplace,
  onRevoke,
  toolbarActions,
}: {
  rows?: ApiCredential[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onReplace: (row: ApiCredential) => void;
  onRevoke: (row: ApiCredential) => void;
  toolbarActions?: React.ReactNode;
}) {
  const vendors = Array.from(
    new Map((rows ?? []).map((r) => [r.vendorId, r.vendorName])).entries()
  ).map(([value, label]) => ({ value, label }));

  const columns: Column<ApiCredential>[] = [
    {
      id: "vendor",
      header: "Vendor",
      sticky: true,
      sortValue: (r) => r.vendorName,
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.vendorName}</div>
          {r.note ? <div className="text-xs text-ink-3">{r.note}</div> : null}
        </div>
      ),
    },
    {
      id: "clientId",
      header: "Client ID",
      sortValue: (r) => r.clientId,
      cell: (r) => (
        <span className="font-mono text-xs break-all">{r.clientId}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <CredentialStatusBadge status={r.status} />
          {r.replacesId ? (
            <span className="text-[11px] text-ink-3">Replacement</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "createdAt",
      header: "Created on",
      sortValue: (r) => r.createdAt,
      cell: (r) => formatDateTime(r.createdAt),
    },
    {
      id: "lastUsedAt",
      header: "Last used",
      sortValue: (r) => r.lastUsedAt,
      cell: (r) =>
        r.lastUsedAt ? (
          formatDateTime(r.lastUsedAt)
        ) : (
          <span className="text-ink-3">Never</span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (r) =>
        r.status === "Active" ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-input bg-surface px-2.5 text-xs font-semibold text-ink-2 transition-colors hover:border-brand-400 hover:text-ink"
              onClick={() => onReplace(r)}
              aria-label={`Replace the credential ${r.clientId} with a new one`}
            >
              Replace
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-danger/40 bg-surface px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger-bg"
              onClick={() => onRevoke(r)}
              aria-label={`Revoke the credential ${r.clientId}`}
            >
              Revoke
            </button>
          </div>
        ) : null,
    },
  ];

  const filters: TypedFilterDef<ApiCredential>[] = [
    {
      id: "vendor",
      label: "Vendor",
      variant: "select",
      options: vendors,
      match: (r, v) => r.vendorId === v,
    },
    {
      id: "status",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: [
        { value: "Active", label: "Active" },
        { value: "Revoked", label: "Revoked" },
      ],
      match: (r, v) => r.status === v,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load API credentials"
      caption="API credentials, with each vendor, its client ID, status, when it was created and when it was last used"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      filters={filters}
      toolbarActions={toolbarActions}
      defaultSort={{ columnId: "createdAt", dir: "desc" }}
      minWidth="52rem"
      emptyIcon={KeyRound}
      emptyTitle="No API credentials yet"
      emptyDescription="Generate a credential so a vendor's own system can send you tickets."
      filteredEmptyTitle="No credentials match"
      filteredEmptyDescription="Try another vendor or status."
    />
  );
}
