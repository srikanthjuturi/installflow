import { useSearchParams } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { CardGridSkeleton, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionCards } from "@/components/dashboard/AttentionCards";
import { DashboardFilterBar } from "@/components/dashboard/DashboardFilterBar";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { RecentTickets } from "@/components/dashboard/RecentTickets";
import { SlaPanel } from "@/components/dashboard/SlaPanel";
import { useDashboard, useRecentTickets } from "@/hooks/useDashboard";
import type { DashboardFilters } from "@/services/dashboard";

/** The filter keys, as they appear in the query string. */
const KEYS = ["regionId", "stateId", "dateFrom", "dateTo"] as const;

/** What the filter bar sends back: only the keys it changed. */
export type FilterPatch = Partial<Record<(typeof KEYS)[number], string | undefined>>;

export default function DashboardPage() {
  /* In the URL, not in component state: filters belong in the query string so a
     view is a link. "Telangana, last week" is a thing somebody pastes into a
     message, and it survives a reload and the back button for free. */
  const [params, setParams] = useSearchParams();
  const filters: DashboardFilters = Object.fromEntries(
    KEYS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)
  );

  /**
   * Apply a PATCH — only the keys it actually names — onto the live URL.
   *
   * A patch rather than the whole filter set, and the functional form rather
   * than a value, because two changes can land in one tick: picking a state and
   * then typing into the date box fires twice before React re-renders, and both
   * writes would otherwise be built from the same stale snapshot. The second
   * one won, and the state silently vanished. `useTicketFilters` solves the
   * same problem with a pending ref; here the router hands us the current value,
   * which is simpler and cannot go stale.
   *
   * A key present with an empty value is a deletion; a key absent is untouched.
   */
  const setFilters = (patch: FilterPatch) => {
    setParams(
      (prev) => {
        const q = new URLSearchParams(prev);
        for (const key of KEYS) {
          if (!(key in patch)) continue;
          const value = patch[key];
          if (value) q.set(key, value);
          else q.delete(key);
        }
        return q;
      },
      // Replace, not push: nudging a filter four times should not put four
      // entries between the reader and wherever they came from.
      { replace: true }
    );
  };

  const summary = useDashboard(filters);
  const recent = useRecentTickets(filters);

  return (
    <>
      <PageMeta
        title="Dashboard"
        description="Open tickets, SLA health, escalations and AI review backlog."
      />

      <div className="flex flex-col gap-3.5">
        {/* Above everything, including the error state: when a filter empties
            the screen the control that did it has to stay in reach. */}
        <DashboardFilterBar filters={filters} onChange={setFilters} />

        {summary.isError ? (
          <ErrorState
            title="Couldn't load the dashboard"
            error={summary.error}
            onRetry={() => summary.refetch()}
          />
        ) : summary.isLoading ? (
          <>
            <CardGridSkeleton />
            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
              <Skeleton className="h-64 rounded-lg" />
              <Skeleton className="h-64 rounded-lg" />
            </div>
          </>
        ) : summary.data ? (
          <>
            <KpiRow kpis={summary.data.kpis} />
            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
              <SlaPanel
                sla={summary.data.sla}
                stages={summary.data.funnel}
                ticketsHref={summary.data.ticketsHref}
              />
              <AttentionCards items={summary.data.attention} />
            </div>
          </>
        ) : null}

        <RecentTickets
          tickets={recent.data}
          isLoading={recent.isLoading}
          error={recent.error}
          onRetry={() => recent.refetch()}
          // Falls back to the bare board while the summary is still loading —
          // the link is drawn before the figures arrive, and a moment of "/"
          // is better than a dead href.
          ticketsHref={summary.data?.ticketsHref ?? "/tickets"}
        />
      </div>
    </>
  );
}
