import { DataTable, type Column } from "@/components/shared/DataTable";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Technician } from "@/types/technician";

interface CandidateTechTableProps {
  technicians?: Technician[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onAssign: (tech: Technician) => void;
  /** Id of the technician whose assignment is in flight, if any. */
  assigningId?: string | null;
  isAssigning?: boolean;
  /** Already on the ticket — offered as a re-assignment target would be odd. */
  currentTechnicianId?: string | null;
}

/** Enough to recognise the coverage without a cell that wraps to five lines. */
const PINCODES_SHOWN = 3;

/**
 * The last-resort fallback list. Normal allocation is first-accept-wins — a
 * row here is picked by a manager because nobody accepted in time, so the
 * technician is told rather than asked.
 *
 * Unpaginated, unlike the technician master list: the server has already
 * narrowed it to one subcategory in one pincode, and a candidate hidden on
 * page 2 is a candidate who does not get considered.
 *
 * The column that is NOT here is the mock's bandwidth bar. "3/6 today" needs
 * open assignments, and nothing assigns anything yet — so the cap is shown for
 * what it is, a cap, and today's load is not claimed at all.
 */
export function CandidateTechTable({
  technicians,
  isLoading,
  error,
  onRetry,
  onAssign,
  assigningId,
  isAssigning = false,
  currentTechnicianId,
}: CandidateTechTableProps) {
  const columns: Column<Technician>[] = [
    {
      id: "name",
      header: "Technician",
      sortValue: (t) => t.name,
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar
            name={t.name}
            src={t.profileImageUrl}
            className="size-8 text-xs"
          />
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
        <span className="text-xs text-ink-2">
          {t.subcategories.map((s) => s.name).join(", ")}
        </span>
      ),
    },
    {
      id: "pincodes",
      header: "Pincodes",
      cell: (t) => (
        <span className="font-mono text-[11px] text-ink-2">
          {t.pincodes.slice(0, PINCODES_SHOWN).join(", ")}
          {t.pincodes.length > PINCODES_SHOWN ? (
            <span className="font-sans text-ink-3">
              {" "}
              +{t.pincodes.length - PINCODES_SHOWN}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "cap",
      header: "Daily cap",
      // Uncapped sorts last: it is the largest capacity, not the smallest.
      sortValue: (t) => t.dailyJobCap ?? Number.MAX_SAFE_INTEGER,
      cellClassName: "tabular-nums",
      cell: (t) => (
        <span className="text-xs text-ink-2">
          {t.dailyJobCap === null ? "No limit" : `${t.dailyJobCap} jobs/day`}
        </span>
      ),
    },
    {
      id: "rating",
      header: "Rating",
      // Null sorts last whichever way the column is pointed — a technician
      // nobody has rated is not the worst-rated one.
      sortValue: (t) => t.rating,
      cell: (t) =>
        t.rating === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums">
              {t.rating.toFixed(1)}
            </span>{" "}
            <span className="text-warn" aria-hidden>
              ★
            </span>
          </>
        ),
    },
    {
      id: "assign",
      header: "Assign",
      // Assigning is an action, not a navigation — so this stays a Button, and
      // its header text stays available to assistive tech while hidden.
      hideHeader: true,
      cell: (t) =>
        t.id === currentTechnicianId ? (
          <span className="text-xs text-ink-3">Currently assigned</span>
        ) : (
          <Button
            size="sm"
            aria-label={`Assign ${t.name}`}
            disabled={isAssigning}
            onClick={() => onAssign(t)}
          >
            {assigningId === t.id ? <Spinner data-icon="inline-start" /> : null}
            Assign
          </Button>
        ),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load eligible technicians"
      caption="Technicians eligible for this ticket, with their categories, service pincodes, daily job cap and rating"
      data={technicians}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by name or pincode…",
        fn: (t, q) =>
          t.name.toLowerCase().includes(q) ||
          t.pincodes.some((p) => p.includes(q)),
      }}
      minWidth="51.25rem"
      emptyTitle="No eligible technicians"
      emptyDescription="Nobody covering this category and pincode is active right now."
    />
  );
}
