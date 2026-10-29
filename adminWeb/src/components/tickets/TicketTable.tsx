import { Link, useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { useNavOrigin, type NavOrigin } from "@/hooks/useNavOrigin";
import { useVendorOptions } from "@/hooks/useVendors";
import type { ListParams, PaginationMeta } from "@/types/api";
import { EMPTY, formatDateTime, formatSlot } from "@/utils/datetime";
import type { SlaState, Ticket } from "@/types";

import { STATUS_FILTER } from "./statusFilter";

/** Breach first — the whole point of the list is triage. */
const SLA_RANK: Record<SlaState, number> = {
  breach: 0,
  warn: 1,
  ok: 2,
  done: 3,
};

interface TicketTableProps {
  /**
   * Where a row leads. The portal mounts this same list under `/portal`, and a
   * hard-coded `/tickets/` would bounce a vendor out through the staff guard.
   */
  basePath?: string;
  /**
   * What the empty state says. Supplied by the caller because the two surfaces
   * are looking at different things — the ops list is every vendor's work, the
   * portal list is your own — and one sentence cannot be true of both.
   */
  emptyDescription?: string;
  /**
   * The empty state's TITLE — not overridable before Task 09 because every
   * surface reading this table has read the same one. The portal splits what
   * "empty" means by reader (a facility role waits for spare-part work, an
   * admin waits for any ticket), so it supplies its own word.
   */
  emptyTitle?: string;
  /** One server page. The table renders these rows and only these rows. */
  tickets?: Ticket[];
  /** The envelope's pagination block — total, page count, where we are. */
  meta?: PaginationMeta;
  /** The request that produced `tickets`. Lives in the URL, owned by the page. */
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /**
   * Whether the URL carries narrowing this toolbar cannot show — the dashboard
   * tiles' "not yet closed", an SLA bucket, a closure window, a pair of
   * statuses. Only the empty state reads it, so a board holding rows back never
   * says "No tickets yet". The page that owns the URL decides; see
   * `TicketListPage`.
   */
  narrowed?: boolean;
  toolbarActions?: React.ReactNode;
  /**
   * What the ticket's own "Back" button should say when opened from here.
   * Supplying it is what makes the detail screen return to THIS list, on this
   * page, with these filters — rather than to the ticket board.
   */
  backLabel?: string;
  /**
   * How the page holding this list was itself reached, forwarded so a ticket
   * opened from a nested list (a technician's jobs) comes back to that list
   * with the trail behind it intact.
   */
  backState?: NavOrigin;
}

export function TicketTable({
  basePath = "/tickets",
  emptyDescription = "Tickets raised by your vendors will appear here.",
  emptyTitle = "No tickets yet",
  tickets,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  narrowed,
  toolbarActions,
  backLabel,
  backState,
}: TicketTableProps) {
  const navigate = useNavigate();
  const origin = useNavOrigin(backLabel, backState);
  const status = params.filters?.status ?? "All";
  // A1: every selectable vendor, for the combobox beside Status. Cached long
  // (see the hook) — fetched here rather than threaded in as a prop because
  // nothing else on this screen needs the list, and the product form already
  // pays for this exact query.
  const vendorOptions = useVendorOptions();
  const vendorId = params.filters?.vendorId ?? "";
  // A2: the board's own flag. "true" or absent — never "false" — because the
  // control is a single pill, not a three-way choice.
  const highPriority = params.filters?.highPriority === "true";

  // Anything that changes WHICH rows match sends the reader back to page 1 —
  // page 4 of an unfiltered list is not page 4 of the filtered one.
  const narrow = (next: ListParams) => onParams({ ...next, page: 1 });

  const columns: Column<Ticket>[] = [
    {
      id: "ticket",
      header: "Ticket",
      sortValue: (t) => t.code,
      cell: (t) => (
        <>
          <div className="flex items-center gap-1.5">
            {/* The row is clickable, but the code stays a real link so it
                is reachable by keyboard and opens in a new tab. */}
            <Link
              to={`${basePath}/${t.id}`}
              state={origin}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs font-semibold text-brand-400"
            >
              {t.code}
            </Link>
            {/* A2: the same flag the detail page shows beside the code —
                no SLA, no routing weight, a flag and nothing else.
                `--brand-accent` is reserved for exactly this. */}
            {t.isHighPriority ? (
              <Badge
                variant="outline"
                className="border-brand-accent text-brand-accent animate-blink"
              >
                High priority
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-ink-3">
            {t.vendorName} · {formatDateTime(t.createdAt)}
          </div>
        </>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      sortValue: (t) => t.customerName,
      cell: (t) => (
        <>
          <div className="font-medium">{t.customerName}</div>
          <div className="text-xs text-ink-3">{t.customerPhone}</div>
        </>
      ),
    },
    {
      id: "category",
      header: "Category / Model",
      sortValue: (t) => t.subcategoryName,
      cell: (t) => (
        <>
          <div>{t.subcategoryName}</div>
          <div className="max-w-50 truncate text-xs text-ink-3">
            {t.modelName}
          </div>
        </>
      ),
    },
    {
      id: "serviceType",
      header: "Service type",
      cell: (t) => t.serviceType,
    },
    // "24h" from the number. The hours are what is stored; the suffix is how
    // the prototype writes it.
    { id: "sla", header: "SLA", cell: (t) => `${t.serviceLevelHours}h` },
    {
      id: "slot",
      header: "Slot",
      sortValue: (t) => t.slotStart ?? "",
      cell: (t) => (
        <>
          <div>{formatSlot(t.slotStart, t.slotEnd)}</div>
          <div className="text-xs text-ink-3">
            {t.city} · {t.pincode}
          </div>
        </>
      ),
    },
    // Null until a technician accepts — first-accept-wins.
    {
      id: "tech",
      header: "Technician",
      cell: (t) => t.technicianName ?? EMPTY,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (t) => t.status,
      cell: (t) => <StatusBadge status={t.status} />,
    },
    {
      id: "slaState",
      header: "SLA state",
      // The server sorts this column on the urgency rank behind the word, so
      // the default order is triage order rather than alphabetical. The rank
      // stays here to mark the column sortable and to show the active arrow.
      sortValue: (t) => SLA_RANK[t.slaState],
      cell: (t) => <SlaBadge state={t.slaState} />,
    },
  ];

  const filters: TypedFilterDef<Ticket>[] = [
    {
      id: "status",
      label: "Status",
      variant: "select",
      options: [
        ...STATUS_FILTER.map((s) => ({ value: s, label: s })),
        // The dashboard's funnel links with a SET — "Closed,Force-Closed". It
        // is not a choice anybody can make here, but while it is in force the
        // trigger should name it the way `NarrowedNotice` does rather than
        // print the raw query value.
        ...(status.includes(",")
          ? [{ value: status, label: status.split(",").join(" or ") }]
          : []),
      ],
      value: status,
      onChange: (v) =>
        narrow({ ...params, filters: { ...params.filters, status: v } }),
      // Never called in server mode — the backend applies the status filter and
      // the table renders what comes back. `match` is required by the type, so
      // it stands here as the identity it effectively is.
      match: () => true,
    },
    {
      // A1: which vendor raised it. A combobox, not a select — the same
      // reasoning the franchisee filter elsewhere uses past ten options: a
      // company's vendor list only grows, and a scrollable menu is the wrong
      // shape for it from day one.
      id: "vendorId",
      label: "Vendor",
      variant: "combobox",
      // No `onSearch` — the whole list is already in hand (cached an hour by
      // the hook) and the combobox filters it locally, the same as any other
      // small option set would.
      options: (vendorOptions.data ?? []).map((v) => ({
        value: v.id,
        label: v.name,
        hint: v.brands.map((b) => b.name).join(", ") || undefined,
      })),
      // "" is the cleared state — never "All": that sentinel belongs to the
      // Status filter's closed set, and a vendor id is never going to equal
      // it by accident, but writing the right one keeps this filter from
      // reading as a special case beside its sibling above.
      allValue: "",
      value: vendorId,
      onChange: (v) =>
        narrow({ ...params, filters: { ...params.filters, vendorId: v } }),
      loading: vendorOptions.isLoading,
      // Server-filtered, like Status above.
      match: () => true,
    },
    {
      // A2: the board's own flag, a single pill rather than a three-value
      // select — "All" or "High priority", because there is no third state
      // anybody asked for.
      id: "highPriority",
      label: "Priority",
      variant: "pills",
      allLabel: "All",
      options: [{ value: "true", label: "High priority" }],
      value: highPriority ? "true" : "All",
      onChange: (v) => {
        const filters = { ...params.filters };
        if (v === "true") filters.highPriority = "true";
        else delete filters.highPriority;
        narrow({ ...params, filters });
      },
      match: () => true,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load tickets"
      caption="Tickets, with their customer, category, SLA, confirmed slot, technician and status"
      data={tickets}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      // No `fn` or `keys`: the server matches ticket ID, customer, mobile and
      // pincode. Matching again here would search one page of an answer.
      search={{
        placeholder: "Search by ticket ID, customer, mobile, pincode…",
        value: params.search ?? "",
        onChange: (v) => narrow({ ...params, search: v }),
      }}
      filters={filters}
      toolbarActions={toolbarActions}
      // No `defaultSort`: until a header is clicked the order is the server's,
      // and no column here carries the date it sorts on, so an arrow on any of
      // them would point at the wrong thing.
      server={{ meta, params, onParams }}
      countLabel={(n) => (
        <>
          Showing <b className="text-ink">{n}</b> tickets
        </>
      )}
      summary={
        // Only true while SLA rank is the active sort — asserting it under any
        // other order would be a lie the table itself contradicts.
        params.sortBy === "slaState" ? (
          <>
            Sorted by <b className="text-ink">SLA urgency</b>
          </>
        ) : !params.sortBy ? (
          // A2: the server's own default now leads with the flag ahead of
          // "newest first" (`service.list_tickets`'s `else` branch) — true
          // whenever nobody named a sort, whether or not the Priority filter
          // is also narrowing the page, so saying so here is never a lie the
          // rows contradict.
          <>
            <b className="text-ink">High-priority</b> tickets shown first
          </>
        ) : null
      }
      onRowClick={(t) => navigate(`${basePath}/${t.id}`, { state: origin })}
      minWidth="57.5rem"
      narrowed={narrowed}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      filteredEmptyTitle="No tickets match those filters"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
