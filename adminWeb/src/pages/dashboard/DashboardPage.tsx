import { PageMeta } from "@/components/shared/PageMeta";
import { CardGridSkeleton, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionCards } from "@/components/dashboard/AttentionCards";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { RecentTickets } from "@/components/dashboard/RecentTickets";
import { SlaPanel } from "@/components/dashboard/SlaPanel";
import { useDashboard, useRecentTickets } from "@/hooks/useDashboard";

export default function DashboardPage() {
  const summary = useDashboard();
  const recent = useRecentTickets();

  return (
    <>
      <PageMeta
        title="Dashboard"
        description="Open tickets, SLA health, escalations and AI review backlog."
      />

      <div className="flex flex-col gap-3.5">
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
              <SlaPanel sla={summary.data.sla} stages={summary.data.funnel} />
              <AttentionCards items={summary.data.attention} />
            </div>
          </>
        ) : null}

        <RecentTickets
          tickets={recent.data}
          isLoading={recent.isLoading}
          error={recent.error}
          onRetry={() => recent.refetch()}
        />
      </div>
    </>
  );
}
