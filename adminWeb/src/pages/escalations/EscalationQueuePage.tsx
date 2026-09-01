import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { LoadMore } from "@/components/shared/LoadMore";
import { Toolbar, type TypedFilterDef } from "@/components/shared/DataTable";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { EscalationCard } from "@/components/escalations/EscalationCard";
import { groupByDay } from "@/lib/dayGroup";
import { relativeTime } from "@/lib/relativeTime";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEscalations } from "@/hooks/useEscalations";
import type { Ticket } from "@/types/ticket";

const ALL = "All";

/**
 * ONE filter, and it is the one that maps onto the two different sittings this
 * screen gets used for: working the jobs that can still be saved, and ringing
 * the customers whose slot went by. Choosing between those is the only cut that
 * changes what a manager is doing rather than only what they are looking at.
 *
 * A bonus filter was built beside it and taken back out, along with its API
 * parameter. Whether money has been spent is already legible on every card — a
 * green figure in the Bonus column against a dash — so the pills bought a
 * second row of controls for something the eye does in one pass. A toolbar
 * wide enough to hide the queue behind it is worse than a queue.
 *
 * Pills rather than a select: three choices, and a filter you can see the state
 * of without opening it is one you remember you left on.
 */
const FILTERS: TypedFilterDef<Ticket>[] = [
  {
    id: "half",
    label: "Show",
    variant: "pills",
    allLabel: "All",
    options: [
      { value: "live", label: "Still savable" },
      { value: "missed", label: "Missed" },
    ],
    match: () => true,
  },
];

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
  const listId = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  // A keystroke must not be a request. 300ms is the point where typing a ticket
  // code feels instant but a six-character code is one query rather than six.
  const search = useDebouncedValue(query, 300);

  // Only what is actually set travels, so an unnarrowed screen hashes to the
  // same query key the rail's badge uses and the two share one request.
  const params = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
  const isNarrowed = Boolean(params.search || params.filters);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useEscalations({ params });

  function setFilter(f: TypedFilterDef<Ticket>, value: string) {
    setFilters((prev) => {
      const next = { ...prev };
      // `All` is the cleared state and must not ride into the query string —
      // the API would have to understand a filter value literally named "All".
      if (value === ALL) delete next[f.id];
      else next[f.id] = value;
      return next;
    });
  }

  function clearAll() {
    setQuery("");
    setFilters({});
  }

  const toolbar = (
    <Toolbar
      search={{ placeholder: "Search code, customer, phone, pincode…" }}
      query={query}
      onQuery={setQuery}
      filters={FILTERS}
      filterValue={(f) => filters[f.id] ?? ALL}
      onFilter={setFilter}
      tableId={listId}
      actions={
        <>
          <DateRange
            from={filters.slotFrom ?? ""}
            to={filters.slotTo ?? ""}
            onChange={(key, value) =>
              setFilters((prev) => {
                const next = { ...prev };
                if (value) next[key] = value;
                else delete next[key];
                return next;
              })
            }
          />
          <RefreshButton
            onRefresh={() => refetch()}
            isFetching={isFetching}
            readAt={dataUpdatedAt}
          />
        </>
      }
    />
  );

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
  // the headings read forward — Today, then Tomorrow. Missed rows run the other
  // way, newest first, so the most recent failure is the one at the top.
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

      {/* Above the error and empty states, not inside the success branch: a
          search that matches nothing must leave the box you typed into on
          screen, or there is no way back except reloading the page. */}
      {isError ? null : toolbar}

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
        // Two different nothings, and telling them apart is the whole point.
        // "Every slot has a technician" over a queue hidden by a filter would
        // be the console telling a manager the work was done.
        isNarrowed ? (
          <EmptyState
            icon={SearchX}
            title="No escalation matches"
            description="Nothing in the queue matches that search and those filters."
            action={
              <Button variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            }
          />
        ) : (
          // An empty queue is the goal state, not a void — say so.
          <EmptyState
            icon={CheckCircle2}
            title="Nothing escalated"
            description="Every confirmed slot within the next 4 hours has a technician."
          />
        )
      ) : (
        <div id={listId}>
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
                    <EscalationCard
                      key={ticket.id}
                      ticket={ticket}
                      readAt={dataUpdatedAt}
                    />
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
                    <EscalationCard
                      key={ticket.id}
                      ticket={ticket}
                      readAt={dataUpdatedAt}
                      missed
                    />
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
        </div>
      )}
    </>
  );
}

/**
 * A slot-date range — `From` and `To`, either usable alone.
 *
 * On the SLOT, which is the date on the cards and on the dividers, not the date
 * the ticket was raised. Those disagree by days on anything booked ahead, and
 * the slot is the one a customer rings about.
 *
 * Two native date inputs rather than a calendar popover. The browser's own
 * control already handles locale, keyboard entry and the mobile picker, and the
 * Toolbar has no date variant to extend — adding one for the single screen that
 * wants it would be a component to maintain for one caller.
 *
 * `max` and `min` cross-bind them, so a range that ends before it starts cannot
 * be expressed. A filter that can be set to return nothing by construction is a
 * filter that will be, and then the empty screen looks like a bug in the queue.
 */
function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (key: "slotFrom" | "slotTo", value: string) => void;
}) {
  const field =
    "h-10 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus-visible:border-brand-400";

  return (
    <div
      className="flex items-center gap-2 text-xs text-ink-3"
      role="group"
      aria-label="Slot date range"
    >
      <span className="whitespace-nowrap">Slot</span>
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onChange("slotFrom", e.target.value)}
        aria-label="Slot date from"
        className={field}
      />
      <span aria-hidden>–</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onChange("slotTo", e.target.value)}
        aria-label="Slot date to"
        className={field}
      />
    </div>
  );
}

/**
 * Refetch every page that is loaded, and say how stale the screen is.
 *
 * The queue already polls once a minute, so this is not what keeps it fresh —
 * it is what lets somebody who has just assigned a technician in another tab
 * stop wondering. The "Updated 40s ago" line beside it is the more useful half:
 * on a screen of countdowns, knowing whether the figures are current is the
 * difference between acting on them and re-reading them.
 *
 * The stamp is read at render rather than ticking on its own. It only needs to
 * be right when somebody looks, and the minute-long poll repaints it anyway.
 */
function RefreshButton({
  onRefresh,
  isFetching,
  readAt,
}: {
  onRefresh: () => void;
  isFetching: boolean;
  readAt: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs whitespace-nowrap text-ink-3 sm:inline">
        {readAt ? `Updated ${relativeTime(new Date(readAt).toISOString())}` : ""}
      </span>
      <Button
        variant="outline"
        onClick={onRefresh}
        disabled={isFetching}
        aria-label="Refresh the escalation queue"
      >
        <RefreshCw
          data-icon="inline-start"
          className={isFetching ? "animate-spin" : undefined}
        />
        Refresh
      </Button>
    </div>
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
