import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { EscalationCard } from "@/components/escalations/EscalationCard";
import { useEscalations } from "@/hooks/useEscalations";
import type { Ticket } from "@/types/ticket";

/**
 * Has this job's window already closed?
 *
 * `slotEnd`, not `slotStart`: while the window is open somebody can still be
 * sent, and a job forty minutes into a two-hour slot is late rather than lost.
 * The API sorts on the same test, so the two halves below are contiguous.
 */
function isMissed(ticket: Ticket, now: number): boolean {
  return ticket.slotEnd !== null && new Date(ticket.slotEnd).getTime() < now;
}

export default function EscalationQueuePage() {
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } =
    useEscalations();

  // Split rather than filtered. A missed appointment is a customer owed an
  // apology, so dropping it would make this the least honest screen in the
  // product — but it is not the same work as a job that can still be saved,
  // and mixed together the dead rows bury the live ones within a fortnight.
  //
  // "Now" is when the rows were READ, not when this happens to render.
  // `Date.now()` here would be an impure call during render — the compiler
  // says so — and it is also the wrong instant: the split would drift from the
  // data it is splitting. This moves exactly when the query does, which the
  // minute-long `refetchInterval` guarantees it does.
  const live = data?.filter((t) => !isMissed(t, dataUpdatedAt)) ?? [];
  const missed = data?.filter((t) => isMissed(t, dataUpdatedAt)) ?? [];
  const count = live.length;

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
      ) : count === 0 && missed.length === 0 ? (
        // An empty queue is the goal state, not a void — say so.
        <EmptyState
          icon={CheckCircle2}
          title="Nothing escalated"
          description="Every confirmed slot within the next 4 hours has a technician."
        />
      ) : (
        <>
          {count > 0 ? (
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
                {live.map((ticket) => (
                  <EscalationCard key={ticket.id} ticket={ticket} />
                ))}
              </div>
            </>
          ) : null}

          {missed.length > 0 ? (
            <section className={count > 0 ? "mt-7" : undefined}>
              {/* Below the live queue and under its own heading. These cannot
                  be rescued — the slot has closed — so the actions on them are
                  about the customer, not the roster. */}
              <h2 className="mb-1 text-sm font-semibold">
                Missed · {missed.length}
              </h2>
              <p className="mb-3.5 text-xs text-ink-3">
                The slot closed with nobody assigned. Each of these is a
                customer who was expecting somebody.
              </p>
              <div className="flex flex-col gap-3">
                {missed.map((ticket) => (
                  <EscalationCard key={ticket.id} ticket={ticket} missed />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
