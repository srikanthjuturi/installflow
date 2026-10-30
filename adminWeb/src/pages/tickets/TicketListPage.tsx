import * as React from "react";
import { Upload } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { NarrowedNotice } from "@/components/shared/NarrowedNotice";
import { TicketImportDialog } from "@/components/tickets/TicketImportDialog";
import { TicketTable } from "@/components/tickets/TicketTable";
import { Button } from "@/components/ui/button";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTickets } from "@/hooks/useTickets";

/** How the board says an SLA bucket it has no control for. */
const SLA_WORDS: Record<string, string> = {
  ok: "on track",
  warn: "due soon",
  breach: "breaching SLA",
};

/** The dashboard's attention cards, named by their own titles. */
const ATTENTION_WORDS: Record<string, string> = {
  "force-close": "awaiting force-close",
  "slot-unconfirmed": "slot not confirmed",
};

export default function TicketListPage() {
  // The whole request — search, status, page, rows-per-page and sort — lives
  // in the query string, so the exact view someone is looking at is a URL they
  // can paste. The page owns it; the table borrows it and reports intent back.
  const { params, setParams, clearNarrowing } = useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTickets(params);
  const [importing, setImporting] = React.useState(false);
  // `jobs.import`, NOT `jobs.create`: staff lost that one deliberately, and it
  // is what draws a Raise-a-ticket screen. Importing a vendor's sheet on their
  // behalf is a different act and carries its own key.
  const canImport = useFeatureAccess().has("jobs.import");

  /* What a dashboard tile narrowed this to, said out loud.
     The board's only visible filter is the Status dropdown, so everything a
     tile sends beyond one status — "not yet closed", an SLA bucket, a closure
     window, a pair of statuses, a territory, a range of intake dates — would
     otherwise withhold rows with nothing on screen to explain it. Same fix, and
     now the same component, as the escalation queue's. */
  const f = params.filters ?? {};
  const closedDays = Number(f.closedWithinDays) || 0;
  const statuses = (f.status ?? "").includes(",") ? f.status.split(",") : null;
  const parts = [
    ...(f.open ? ["not yet closed"] : []),
    ...(f.closed ? ["closed"] : []),
    ...(ATTENTION_WORDS[f.attention] ? [ATTENTION_WORDS[f.attention]] : []),
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

  // The high-priority board's own three views. Each REPLACES the filters
  // wholesale rather than merging, so no stale status/vendorId/
  // closedWithinDays/attention can linger underneath whichever view is
  // picked next.
  const isActiveHighPriority = f.highPriority === "true" && f.open === "true";
  const isClosedTickets = f.highPriority === "true" && f.closed === "true";
  const isAllTickets = !isActiveHighPriority && !isClosedTickets;

  return (
    <>
      <PageMeta
        title="Tickets"
        description="All installation & demo tickets."
      />

      {/* The high-priority board's own three views — unfiltered, still open,
          or closed (so staff can review a closure's detail). Plain buttons
          rather than a new primitive: the console has no shadcn Tabs yet. */}
      <div className="flex items-center gap-2">
        <Button
          size="toolbar"
          variant={isAllTickets ? "default" : "outline"}
          onClick={() => setParams({ ...params, filters: {}, page: 1 })}
        >
          All Tickets
        </Button>
        <Button
          size="toolbar"
          variant={isActiveHighPriority ? "default" : "outline"}
          onClick={() =>
            setParams({
              ...params,
              filters: { highPriority: "true", open: "true" },
              page: 1,
            })
          }
        >
          Active High Priority
        </Button>
        <Button
          size="toolbar"
          variant={isClosedTickets ? "default" : "outline"}
          onClick={() =>
            setParams({
              ...params,
              filters: { highPriority: "true", closed: "true" },
              page: 1,
            })
          }
        >
          Closed Tickets
        </Button>
      </div>

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
        toolbarActions={
          canImport ? (
            <Button size="toolbar" onClick={() => setImporting(true)}>
              <Upload data-icon="inline-start" />
              Import tickets
            </Button>
          ) : null
        }
      />

      <TicketImportDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}
