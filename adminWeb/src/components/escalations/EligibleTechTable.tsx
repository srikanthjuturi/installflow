import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "@/components/shared/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { Technician } from "@/types";

const COLUMNS = ["Technician", "Categories", "Pincodes", "Bandwidth", "Rating", "Cancels"];

interface EligibleTechTableProps {
  technicians?: Technician[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onAssign: (tech: Technician) => void;
  /** Name of the technician whose assignment is in flight, if any. */
  assigningName?: string | null;
  isAssigning?: boolean;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

/**
 * The last-resort fallback list. Normal allocation is first-accept-wins — a
 * row here is picked by a manager because nobody accepted in time, so the
 * technician is told rather than asked.
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
  if (error) {
    return (
      <div className="p-4.5">
        <ErrorState
          title="Couldn't load eligible technicians"
          error={error}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (!isLoading && !technicians?.length) {
    return (
      <div className="p-4.5">
        <EmptyState
          title="No eligible technicians"
          description="Nobody covering this category and pincode has bandwidth left today."
        />
      </div>
    );
  }

  return (
    <div className="scroll-x">
      <Table className="min-w-205">
        <TableHeader>
          <HeadTr>
            {COLUMNS.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
            <Th>
              <span className="sr-only">Assign</span>
            </Th>
          </HeadTr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton rows={5} cols={COLUMNS.length + 1} />
          ) : (
            technicians?.map((t) => {
              const ratio = t.bwTotal === 0 ? 0 : t.bwUsed / t.bwTotal;
              const busy = ratio > 0.79;

              return (
                <Tr key={t.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="bg-status-assigned-bg text-brand-400 grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
                      >
                        {initials(t.name)}
                      </span>
                      <span>
                        <span className="block font-medium">{t.name}</span>
                        <span className="text-ink-3 block text-xs">{t.phone}</span>
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className="text-ink-2 text-xs">{t.cats.join(", ")}</span>
                  </Td>
                  <Td>
                    <span className="text-ink-2 font-mono text-[11px]">{t.pincodes}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {/* Data-driven geometry, so the width is the one thing that
                          cannot be a static class. The colour still comes from a
                          token, and the count beside it carries the meaning —
                          the tint alone never does. */}
                      <span
                        aria-hidden
                        className="bg-surface-3 block h-1.5 w-13.5 overflow-hidden rounded-full"
                      >
                        <span
                          className={cn("block h-full", busy ? "bg-warn" : "bg-ok")}
                          style={{ width: `${Math.round(ratio * 100)}%` }}
                        />
                      </span>
                      <span className="text-ink-2 text-xs tabular-nums">
                        {t.bwUsed}/{t.bwTotal}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className="font-semibold tabular-nums">{t.rating}</span>{" "}
                    <span className="text-warn" aria-hidden>
                      ★
                    </span>
                  </Td>
                  <Td className="tabular-nums">{t.cancels}</Td>
                  <Td>
                    <Button
                      size="sm"
                      aria-label={`Assign ${t.name}`}
                      disabled={isAssigning}
                      onClick={() => onAssign(t)}
                    >
                      {assigningName === t.name ? <Spinner data-icon="inline-start" /> : null}
                      Assign
                    </Button>
                  </Td>
                </Tr>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
