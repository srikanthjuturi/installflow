import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
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
import { ConfidenceMeter } from "./ConfidenceMeter";
import { DetectedSerial } from "./SerialCompare";
import type { AiFlag } from "@/types";

const COLUMNS = [
  "Ticket",
  "Customer / product",
  "Expected serial",
  "Detected",
  "Confidence",
  "Flag",
];

interface AiQueueTableProps {
  flags?: AiFlag[];
  threshold: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function AiQueueTable({
  flags,
  threshold,
  isLoading,
  error,
  onRetry,
}: AiQueueTableProps) {
  const navigate = useNavigate();

  if (error) {
    return (
      <ErrorState
        title="Couldn't load the AI review queue"
        error={error}
        onRetry={onRetry}
      />
    );
  }

  // An empty queue is the goal state: every verification cleared the threshold
  // and closed itself. Say that, rather than showing a void.
  if (!isLoading && !flags?.length) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nothing waiting on review"
        description={`Every verification cleared the ${threshold}% confidence threshold and went straight to closure.`}
      />
    );
  }

  return (
    <div className="scroll-x">
      <Table className="min-w-220">
        <TableHeader>
          <HeadTr>
            {COLUMNS.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </HeadTr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton rows={4} cols={COLUMNS.length + 1} />
          ) : (
            flags?.map((a) => (
              <Tr
                key={a.id}
                onClick={() => navigate(`/ai-review/${a.id}`)}
                className="cursor-pointer"
              >
                <Td>
                  {/* The row is clickable, but the id stays a real link so it is
                      reachable by keyboard and opens in a new tab. */}
                  <Link
                    to={`/ai-review/${a.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-brand-400 font-mono text-xs font-semibold"
                  >
                    {a.id}
                  </Link>
                  <div className="text-ink-3 mt-0.5 text-[11px]">
                    {a.when} · {a.tech}
                  </div>
                </Td>
                <Td>
                  <div className="font-medium">{a.customer}</div>
                  <div className="text-ink-3 max-w-50 truncate text-[11px]">{a.product}</div>
                </Td>
                <Td>
                  <span className="font-mono text-xs">{a.expectedSerial}</span>
                </Td>
                <Td>
                  <DetectedSerial expected={a.expectedSerial} detected={a.detectedSerial} />
                </Td>
                <Td>
                  <ConfidenceMeter conf={a.conf} threshold={threshold} />
                </Td>
                <Td>
                  <span className="text-ink-2 text-xs">{a.flag}</span>
                </Td>
                <Td>
                  <LinkButton
                    variant="outline"
                    to={`/ai-review/${a.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Review
                    <ArrowRight data-icon="inline-end" />
                  </LinkButton>
                </Td>
              </Tr>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
