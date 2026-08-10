import { DataTable, type Column } from "@/components/shared/DataTable";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { EligibleTechnician } from "@/types";

interface EligibleTechTableProps {
  technicians?: EligibleTechnician[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onAssign: (tech: EligibleTechnician) => void;
  /** Name of the technician whose assignment is in flight, if any. */
  assigningName?: string | null;
  isAssigning?: boolean;
}

/**
 * The last-resort fallback list. Normal allocation is first-accept-wins — a
 * row here is picked by a manager because nobody accepted in time, so the
 * technician is told rather than asked.
 *
 * Client-filtered and unpaginated, unlike the technician master list: this is
 * the shortlist for one ticket, read inside a card as a decision is made. A
 * candidate hidden on page 2 is a candidate who does not get considered.
 */
export function EligibleTechTable({
  technicians,
  isLoading,
  error,
  onRetry,
  onAssign,
  assigningName,
  isAssigning = false,
}: EligibleTechTableProps) {
  const columns: Column<EligibleTechnician>[] = [
    {
      id: "name",
      header: "Technician",
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar name={t.name} src={t.photoUrl} className="size-8 text-xs" />
          <span>
            <span className="block font-medium">{t.name}</span>
            <span className="block text-xs text-ink-3">{t.phone}</span>
          </span>
        </div>
      ),
    },
    {
      id: "cats",
      header: "Categories",
      cell: (t) => (
        <span className="text-xs text-ink-2">{t.cats.join(", ")}</span>
      ),
    },
    {
      id: "pincodes",
      header: "Pincodes",
      cell: (t) => (
        <span className="font-mono text-[11px] text-ink-2">{t.pincodes}</span>
      ),
    },
    {
      id: "bandwidth",
      header: "Bandwidth",
      // Sorts on how full they are, not the raw cap — 5/5 is busier than 2/6.
      sortValue: (t) => (t.bwTotal === 0 ? 0 : t.bwUsed / t.bwTotal),
      cell: (t) => {
        const ratio = t.bwTotal === 0 ? 0 : t.bwUsed / t.bwTotal;
        const busy = ratio > 0.79;

        return (
          <div className="flex items-center gap-2">
            {/* Data-driven geometry, so the width is the one thing that
                cannot be a static class. The colour still comes from a
                token, and the count beside it carries the meaning —
                the tint alone never does. */}
            <span
              aria-hidden
              className="block h-1.5 w-13.5 overflow-hidden rounded-full bg-surface-3"
            >
              <span
                className={cn("block h-full", busy ? "bg-warn" : "bg-ok")}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="text-xs text-ink-2 tabular-nums">
              {t.bwUsed}/{t.bwTotal}
            </span>
          </div>
        );
      },
    },
    {
      id: "rating",
      header: "Rating",
      sortValue: (t) => t.rating,
      cell: (t) => (
        <>
          <span className="font-semibold tabular-nums">{t.rating}</span>{" "}
          <span className="text-warn" aria-hidden>
            ★
          </span>
        </>
      ),
    },
    {
      id: "cancels",
      header: "Cancels",
      sortValue: (t) => t.cancels,
      cellClassName: "tabular-nums",
      cell: (t) => t.cancels,
    },
    {
      id: "assign",
      header: "Assign",
      // Assigning is an action, not a navigation — so this stays a Button, and
      // its header text stays available to assistive tech while hidden.
      hideHeader: true,
      cell: (t) => (
        <Button
          size="sm"
          aria-label={`Assign ${t.name}`}
          disabled={isAssigning}
          onClick={() => onAssign(t)}
        >
          {assigningName === t.name ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          Assign
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load eligible technicians"
      caption="Technicians eligible for this ticket, with their categories, service pincodes, bandwidth, rating and cancellation history"
      data={technicians}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name or pincode…",
        fn: (t, q) =>
          t.name.toLowerCase().includes(q) || t.pincodes.includes(q),
      }}
      minWidth="51.25rem"
      emptyTitle="No eligible technicians"
      emptyDescription="Nobody covering this category and pincode has bandwidth left today."
    />
  );
}
