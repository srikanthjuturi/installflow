import { Link, useNavigate } from "react-router";
import { Users } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { formatPhone } from "@/utils/phone";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { TechnicianRow } from "@/types/technician";
import { BandwidthBar, CancelCount } from "./BandwidthBar";
import { OnboardingStatusCell } from "./OnboardingStatusCell";
import { INVITE_STATUSES, STATUS_LABEL, isResendable } from "./onboarding";

/** A typographic null. Not copy — an invite simply has no value to show. */
const NONE = "—";

interface TechTableProps {
  /** One page of rows, already searched, filtered and sorted by the server. */
  rows?: TechnicianRow[];
  meta?: PaginationMeta;
  params: ListParams;
  /** Merges what it is given into the query — see `applyParams` on the page. */
  onParams: (next: ListParams) => void;
  regions: { id: string; name: string }[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
  canEdit: boolean;
  onResend: (row: TechnicianRow) => void;
  onCancel: (row: TechnicianRow) => void;
  busyInviteId?: string | null;
}

export function TechTable({
  rows,
  meta,
  params,
  onParams,
  regions,
  isLoading,
  error,
  onRetry,
  toolbarActions,
  canEdit,
  onResend,
  onCancel,
  busyInviteId,
}: TechTableProps) {
  const navigate = useNavigate();

  /**
   * "Clear filters" writes the search and every filter in one event, and each
   * call would otherwise be derived from the same render's `params` — only the
   * last would survive. The writer threads them so they stay additive, and
   * `withFilter` drops "All" rather than sending it as a filter value.
   */
  const write = useParamsWriter(params, onParams);
  const setSearch = (search: string) =>
    write((current) => withSearch(current, search));
  const setFilter = (id: string, value: string) =>
    write((current) => withFilter(current, id, value));

  const columns: Column<TechnicianRow>[] = [
    {
      id: "name",
      header: "Technician",
      cell: (t) =>
        t.registered ? (
          <div className="flex items-center gap-2.5">
            <UserAvatar
              name={t.name}
              src={t.profileImageUrl ?? undefined}
              className="size-8.5 text-xs"
            />
            <div className="min-w-0">
              {/* A real link so the row is keyboard reachable and opens in a
                  new tab — the row click is a convenience on top. */}
              <Link
                to={`/technicians/${t.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium hover:text-brand-400"
              >
                {t.name}
              </Link>
              <div className="font-mono text-xs text-ink-3">{t.code}</div>
            </div>
          </div>
        ) : (
          /* Until they register, the number IS the record — so it is the
             primary line rather than a subtitle under a blank name. */
          <div className="flex items-center gap-2.5">
            <UserAvatar name="?" className="size-8.5 text-xs opacity-60" />
            <div className="min-w-0">
              <div className="font-mono font-medium">{formatPhone(t.phone)}</div>
              <div className="text-xs text-ink-3">Invited, not registered</div>
            </div>
          </div>
        ),
    },
    {
      id: "cats",
      header: "Categories",
      cell: (t) =>
        t.registered ? t.subcategories.map((s) => s.name).join(", ") : NONE,
    },
    {
      id: "pincodes",
      header: "Pincodes",
      cell: (t) =>
        t.registered ? (
          <span className="font-mono text-xs">{t.pincodes.join(", ")}</span>
        ) : (
          NONE
        ),
    },
    {
      id: "region",
      header: "Region",
      cell: (t) => t.regionName,
    },
    {
      id: "bandwidth",
      header: "Bandwidth",
      cell: (t) =>
        t.registered ? (
          <BandwidthBar used={t.bwUsed} total={t.dailyJobCap} />
        ) : (
          NONE
        ),
    },
    {
      id: "jobs",
      header: "Jobs",
      align: "right",
      cell: (t) =>
        t.registered ? (
          <span className="tabular-nums">{t.jobsCompleted}</span>
        ) : (
          NONE
        ),
    },
    {
      id: "cancels",
      header: "Cancels",
      align: "right",
      cell: (t) =>
        t.registered ? <CancelCount cancels={t.jobsCancelled} /> : NONE,
    },
    {
      id: "appointedBy",
      header: "Appointed by",
      cell: (t) => {
        const name = t.registered
          ? t.onboarding.appointedByName
          : t.invitedByName;
        return <span className="text-xs text-ink-2">{name ?? NONE}</span>;
      },
    },
    {
      id: "status",
      header: "Status",
      cell: (t) => <OnboardingStatusCell row={t} />,
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      cell: (t) => {
        if (t.registered || !canEdit || !isResendable(t.status)) return null;
        const busy = busyInviteId === t.id;
        return (
          <div
            className="flex justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onResend(t)}
            >
              Resend
              <span className="sr-only"> invite to {formatPhone(t.phone)}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger"
              disabled={busy}
              onClick={() => onCancel(t)}
            >
              Cancel
              <span className="sr-only"> invite to {formatPhone(t.phone)}</span>
            </Button>
          </div>
        );
      },
    },
  ];

  /**
   * The defs own the label and the options — the toolbar renders from them.
   * What they do not own is the matching: the value goes into `params.filters`
   * and the server narrows the result set, so `match` is never called.
   */
  const filters: TypedFilterDef<TechnicianRow>[] = [
    {
      id: "onboarding",
      label: "Onboarding",
      variant: "select",
      options: INVITE_STATUSES.filter((s) => s !== "registered").map((s) => ({
        value: s,
        label: STATUS_LABEL[s],
      })),
      value: filterValue(params, "onboarding"),
      onChange: (v) => setFilter("onboarding", v),
      match: () => true,
    },
    {
      id: "status",
      label: "Status",
      variant: "select",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
        { value: "suspended", label: "Suspended" },
      ],
      value: filterValue(params, "status"),
      onChange: (v) => setFilter("status", v),
      match: () => true,
    },
  ];

  // A manager who holds one region has nothing to choose between.
  if (regions.length > 1) {
    filters.push({
      id: "regionId",
      label: "Region",
      variant: "select",
      options: regions.map((r) => ({ value: r.id, label: r.name })),
      value: filterValue(params, "regionId"),
      onChange: (v) => setFilter("regionId", v),
      match: () => true,
    });
  }

  return (
    <DataTable
      errorTitle="Couldn't load technicians"
      caption="Technicians and open invites, with their categories, service pincodes, region, bandwidth and who appointed them"
      data={rows}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name, mobile, ID or pincode…",
        value: params.search ?? "",
        onChange: setSearch,
      }}
      filters={filters}
      toolbarActions={toolbarActions}
      server={{ meta, params, onParams }}
      onRowClick={(t) => t.registered && navigate(`/technicians/${t.id}`)}
      minWidth="82rem"
      emptyIcon={Users}
      emptyTitle="No technicians yet"
      emptyDescription="Add a technician, or invite one by mobile number and let them register themselves."
      filteredEmptyTitle="No technicians match those filters"
      filteredEmptyDescription="Try a different status or region, or clear the search."
    />
  );
}
