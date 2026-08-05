import { Link, useNavigate } from "react-router";
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
import type { Technician } from "@/types";
import { BandwidthBar, CancelCount, TechAvatar, TechStatusPill } from "./BandwidthBar";

const COLUMNS = [
  "Technician",
  "Categories",
  "Pincodes",
  "Bandwidth",
  "Rating",
  "Jobs",
  "Cancels",
  "Status",
];

interface TechTableProps {
  technicians?: Technician[];
  isLoading: boolean;
  error: unknown;
  isFiltered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
}

export function TechTable({
  technicians,
  isLoading,
  error,
  isFiltered,
  onRetry,
  onClearFilters,
}: TechTableProps) {
  const navigate = useNavigate();

  if (error) {
    return (
      <ErrorState title="Couldn't load technicians" error={error} onRetry={onRetry} />
    );
  }

  if (!isLoading && !technicians?.length) {
    return isFiltered ? (
      <EmptyState
        title="No technicians match those filters"
        description="Try a different category, or clear the search."
        action={
          <button
            type="button"
            onClick={onClearFilters}
            className="text-brand-400 hover:text-brand-500 text-sm font-semibold"
          >
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState
        title="No technicians yet"
        description="Onboarded technicians appear here with their categories, pincodes and bandwidth."
      />
    );
  }

  return (
    <div className="scroll-x">
      <Table className="min-w-240">
        <TableHeader>
          <HeadTr>
            {COLUMNS.map((c) => (
              <Th key={c} scope="col">
                {c}
              </Th>
            ))}
          </HeadTr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton rows={8} cols={COLUMNS.length} />
          ) : (
            technicians?.map((t) => (
              <Tr
                key={t.id}
                onClick={() => navigate(`/technicians/${t.id}`)}
                className="cursor-pointer"
              >
                <Td>
                  <div className="flex items-center gap-2.5">
                    <TechAvatar name={t.name} />
                    <div>
                      {/* The whole row is clickable, but the name stays a real
                          link so it is reachable by keyboard and opens in a
                          new tab. */}
                      <Link
                        to={`/technicians/${t.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium"
                      >
                        {t.name}
                      </Link>
                      <div className="text-ink-3 font-mono text-[11px]">{t.id}</div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <span className="text-ink-2 text-xs">{t.cats.join(", ")}</span>
                </Td>
                <Td>
                  <span className="text-ink-2 font-mono text-[11px]">{t.pincodes}</span>
                </Td>
                <Td>
                  <BandwidthBar used={t.bwUsed} total={t.bwTotal} />
                </Td>
                <Td>
                  <span className="font-semibold tabular-nums">{t.rating}</span>{" "}
                  <span className="text-warn" aria-hidden>
                    ★
                  </span>
                </Td>
                <Td className="tabular-nums">{t.jobs}</Td>
                <Td>
                  <CancelCount cancels={t.cancels} />
                </Td>
                <Td>
                  <TechStatusPill status={t.status} />
                </Td>
              </Tr>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
