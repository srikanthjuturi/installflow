import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/utils/phone";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { PartnerInvite, PartnerKind } from "@/types/partner";
import {
  PARTNER_STATUSES,
  STATUS_CLASS,
  STATUS_LABEL,
} from "./partnerSchema";

interface PartnerTableProps {
  kind: PartnerKind;
  invites?: PartnerInvite[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onResend: (invite: PartnerInvite) => void;
  onCancel: (invite: PartnerInvite) => void;
  isBusy: boolean;
  toolbarActions?: React.ReactNode;
}

export function PartnerTable({
  kind,
  invites,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  onResend,
  onCancel,
  isBusy,
  toolbarActions,
}: PartnerTableProps) {
  const write = useParamsWriter(params, onParams);
  const label = kind.toLowerCase();
  const plural = `${label}s`;

  const columns: Column<PartnerInvite>[] = [
    {
      id: "phone",
      header: "Mobile number",
      cell: (p) => (
        <div className="leading-tight">
          <p className="font-mono text-[13px] font-medium text-ink">
            {formatPhone(p.phone)}
          </p>
          {p.fullName ? (
            <p className="text-[11px] text-ink-3">{p.fullName}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        <div className="leading-tight">
          {/* Never colour alone — the status word is always present. */}
          <span
            className={cn(
              "inline-flex items-center gap-1.25 text-xs font-semibold",
              STATUS_CLASS[p.status]
            )}
          >
            <span aria-hidden className="size-1.75 rounded-full bg-current" />
            {STATUS_LABEL[p.status]}
          </span>
          {/* Why it failed belongs next to the failure, not in a log. */}
          {p.failureReason ? (
            <p className="mt-0.5 max-w-56 truncate text-[11px] text-ink-3" title={p.failureReason}>
              {p.failureReason}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "region",
      header: "Region",
      cell: (p) => <span className="text-[13px]">{p.regionName}</span>,
    },
    {
      id: "invitedBy",
      header: "Invited by",
      cell: (p) => (
        <span className="text-xs text-ink-2">{p.invitedByName ?? "—"}</span>
      ),
    },
    {
      id: "sentAt",
      header: "Invited on",
      cell: (p) =>
        new Date(p.sentAt ?? p.createdAt).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      cell: (p) =>
        p.status === "registered" || p.status === "cancelled" ? (
          <span className="text-xs text-ink-3">
            <span aria-hidden>—</span>
            <span className="sr-only">No actions available</span>
          </span>
        ) : (
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              disabled={isBusy}
              onClick={() => onResend(p)}
            >
              Resend
              <span className="sr-only"> to {p.phone}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-danger"
              disabled={isBusy}
              onClick={() => onCancel(p)}
            >
              Cancel
              <span className="sr-only"> the invite to {p.phone}</span>
            </Button>
          </div>
        ),
    },
  ];

  return (
    <DataTable
      errorTitle={`Couldn't load ${plural}`}
      caption={`${kind} invites, with delivery status, region and who invited them`}
      data={invites}
      columns={columns}
      getRowId={(p) => p.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by mobile number or name…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={[
        {
          id: "status",
          label: "Status",
          variant: "select",
          options: PARTNER_STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABEL[s],
          })),
          value: filterValue(params, "status"),
          onChange: (v) => write((p) => withFilter(p, "status", v)),
          match: (p, value) => p.status === value,
        },
      ]}
      server={{ meta, params, onParams }}
      toolbarActions={toolbarActions}
      minWidth="54rem"
      emptyTitle={`No ${plural} yet`}
      emptyDescription={`Invite one and a WhatsApp link goes to their mobile number. Until the ${label} registers, the record stays here.`}
      emptyAction={toolbarActions}
      filteredEmptyTitle={`No ${plural} match those filters`}
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
