import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { LoadMore } from "@/components/shared/LoadMore";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { EscalationCard } from "@/components/escalations/EscalationCard";
import { groupByDay } from "@/lib/dayGroup";
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
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    dataUpdatedAt,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useEscalations();

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
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const live = rows.filter((t) => !isMissed(t, dataUpdatedAt));
  const missed = rows.filter((t) => isMissed(t, dataUpdatedAt));
  const count = live.length;

  // Days, in the order the server sent them. Live rows run soonest-first, so
  // the headings read forward — Today, then Tomorrow. Missed rows run
  // soonest-first too, which puts the longest-waiting customer at the top.
  const readAt = new Date(dataUpdatedAt);
  const liveDays = groupByDay(live, (t) => t.slotStart!, readAt);
  const missedDays = groupByDay(missed, (t) => t.slotStart!, readAt);

  // The live half is fully loaded once a missed row has arrived — the API puts
  // every live row before any missed one — or once there is nothing more to
  // load at all. Until then the banner's figure is a floor, not a total, and
  // says so rather than under-reporting a queue somebody is about to work.
  const liveComplete = missed.length > 0 || !hasNextPage;
  // Whole minus loaded-live, which is exact whenever the section renders:
  // `missed.length > 0` is precisely the case that makes `liveComplete` true.
  const missedTotal =
    (data?.pages.at(-1)?.pagination.totalRecords ?? 0) - live.length;

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
                    {count}
                    {liveComplete ? "" : "+"} ticket{count === 1 ? "" : "s"}
                  </b>{" "}
                  {count === 1 ? "is" : "are"} unassigned within 4 hours of their
                  confirmed slot. Add a bonus and re-notify, or assign manually.
                </span>
              </p>

              {liveDays.map((day) => (
                <DaySection key={day.key} label={day.label}>
                  {day.items.map((ticket) => (
                    <EscalationCard key={ticket.id} ticket={ticket} />
                  ))}
                </DaySection>
              ))}
            </>
          ) : null}

          {missed.length > 0 ? (
            <section className={count > 0 ? "mt-7" : undefined}>
              {/* Below the live queue and under its own heading. These cannot
                  be rescued — the slot has closed — so the actions on them are
                  about the customer, not the roster. */}
              <h2 className="mb-1 text-sm font-semibold">
                Missed · {missedTotal}
              </h2>
              <p className="mb-3.5 text-xs text-ink-3">
                The slot closed with no technician assigned. Each one is a
                customer who was expecting a visit.
              </p>
              {missedDays.map((day) => (
                <DaySection key={day.key} label={day.label}>
                  {day.items.map((ticket) => (
                    <EscalationCard key={ticket.id} ticket={ticket} missed />
                  ))}
                </DaySection>
              ))}
            </section>
          ) : null}

          <LoadMore
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            label="escalations"
          />
        </>
      )}
    </>
  );
}

/**
 * One day's cards under a sticky heading.
 *
 * Sticky because the missed half grows without bound and nothing clears it: on
 * a queue spanning weeks, the day being read scrolls off long before its last
 * card does, and a divider you cannot see is a divider that is not dividing.
 * Matches the notification feed's treatment, which solves the same problem.
 */
function DaySection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {/* `bg-background`, which is the page's own canvas — `bg-surface` is
          white, and painting that here drew a white band across a grey page
          that read as a panel rather than as a heading. */}
      <h3 className="sticky top-topbar z-10 bg-background/90 py-2 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase backdrop-blur-sm">
        {label}
      </h3>
      <div className="flex flex-col gap-3 pb-2">{children}</div>
    </section>
  );
}
