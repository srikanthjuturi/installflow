import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { EscalationCard } from "@/components/escalations/EscalationCard";
import { useEscalations } from "@/hooks/useEscalations";

export default function EscalationQueuePage() {
  const { data, isLoading, isError, error, refetch } = useEscalations();
  const count = data?.length ?? 0;

  return (
    <>
      <PageMeta
        title="Escalation queue"
        description="Tickets unassigned within 4 hours of their confirmed slot."
      />

      {isError ? (
        <ErrorState
          title="Couldn't load the escalation queue"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 rounded-md" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : count === 0 ? (
        // An empty queue is the goal state, not a void — say so.
        <EmptyState
          icon={CheckCircle2}
          title="Nothing escalated"
          description="Every confirmed slot within the next 4 hours has a technician."
        />
      ) : (
        <>
          <p className="mb-3.5 flex items-center gap-2.5 rounded-md bg-danger-bg px-4 py-3.25 text-[13px] text-danger">
            <AlertTriangle className="size-4.5 shrink-0" aria-hidden />
            <span>
              <b>
                {count} ticket{count === 1 ? "" : "s"}
              </b>{" "}
              {count === 1 ? "is" : "are"} unassigned within 4 hours of their
              confirmed slot. Add a bonus and re-notify, or assign manually.
            </span>
          </p>

          <div className="flex flex-col gap-3">
            {data?.map((e) => (
              <EscalationCard key={e.id} escalation={e} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
