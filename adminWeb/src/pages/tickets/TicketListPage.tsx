import { PageMeta } from "@/components/shared/PageMeta";
import { NarrowedNotice } from "@/components/shared/NarrowedNotice";
import { TicketTable } from "@/components/tickets/TicketTable";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTickets } from "@/hooks/useTickets";

/** How the board says an SLA bucket it has no control for. */
const SLA_WORDS: Record<string, string> = {
  ok: "on track",
  warn: "due soon",
  breach: "breaching SLA",
};

export default function TicketListPage() {
  // The whole request — search, status, page, rows-per-page and sort — lives
  // in the query string, so the exact view someone is looking at is a URL they
  // can paste. The page owns it; the table borrows it and reports intent back.
  const { params, setParams, clearNarrowing } = useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTickets(params);

  /* What a dashboard tile narrowed this to, said out loud.
     The board's only visible control is the status chip row, so everything a
     tile sends beyond one status — "not yet closed", an SLA bucket, a closure
     window, a pair of statuses, a territory, a range of intake dates — would
     otherwise withhold rows with nothing on screen to explain it. Same fix, and
     now the same component, as the escalation queue's. */
  const f = params.filters ?? {};
  const closedDays = Number(f.closedWithinDays) || 0;
  const statuses = (f.status ?? "").includes(",") ? f.status.split(",") : null;
  const parts = [
    ...(f.open ? ["not yet closed"] : []),
    // Named because the chips cannot show a set — one of them would look
    // selected and the other would not exist.
    ...(statuses ? [statuses.join(" or ")] : []),
    ...(closedDays
      ? [`closed in the last ${closedDays} day${closedDays === 1 ? "" : "s"}`]
      : []),
    ...(SLA_WORDS[f.slaState] ? [SLA_WORDS[f.slaState]] : []),
    ...(f.dateFrom || f.dateTo ? ["raised in a date range"] : []),
    ...(f.regionId || f.stateId ? ["one territory"] : []),
  ];

  return (
    <>
      <PageMeta
        title="Tickets"
        description="All installation & demo tickets."
      />

      <NarrowedNotice
        parts={parts}
        actionLabel="Show the whole board"
        onClear={clearNarrowing}
      />

      <TicketTable
        tickets={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        // So a narrowed board that matches nothing says so, rather than "No
        // tickets yet" over rows it is deliberately holding back.
        narrowed={parts.length > 0}
        emptyDescription="Tickets raised by your vendors will appear here."
        /* Same words as the old hard-coded default, but now it returns to the
           page and filters you left rather than a bare /tickets. */
        backLabel="Back to tickets"
      />
    </>
  );
}
