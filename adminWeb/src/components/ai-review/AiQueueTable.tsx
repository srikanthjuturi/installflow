import { useMemo } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { DetectedSerial } from "./SerialCompare";
import type { AiFlag } from "@/types";

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

  // Built from the queue itself: a reason the model never returns should not
  // sit in the filter offering nothing.
  const flagOptions = useMemo(
    () =>
      [...new Set((flags ?? []).map((a) => a.flag))]
        .sort()
        .map((flag) => ({ value: flag, label: flag })),
    [flags]
  );

  const columns: Column<AiFlag>[] = [
    {
      id: "ticket",
      header: "Ticket",
      // Sorts on the id, which is what the header says. The cell also carries
      // the flag time, but a header labelled "Ticket" that reorders by time
      // would be lying about what the click did — recency sorting belongs on
      // a column that names it, and this table has no time column.
      sortValue: (a) => a.id,
      cell: (a) => (
        <>
          {/* The row is clickable, but the id stays a real link so it is
              reachable by keyboard and opens in a new tab. */}
          <Link
            to={`/ai-review/${a.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs font-semibold text-brand-400"
          >
            {a.id}
          </Link>
          <div className="mt-0.5 text-[11px] text-ink-3">
            {a.when} · {a.tech}
          </div>
        </>
      ),
    },
    {
      id: "customer",
      header: "Customer / product",
      cell: (a) => (
        <>
          <div className="font-medium">{a.customer}</div>
          <div className="max-w-50 truncate text-[11px] text-ink-3">
            {a.product}
          </div>
        </>
      ),
    },
    {
      id: "expectedSerial",
      header: "Expected serial",
      cell: (a) => (
        <span className="font-mono text-xs">{a.expectedSerial}</span>
      ),
    },
    {
      id: "detectedSerial",
      header: "Detected",
      cell: (a) => (
        <DetectedSerial
          expected={a.expectedSerial}
          detected={a.detectedSerial}
        />
      ),
    },
    {
      id: "conf",
      header: "Confidence",
      // The raw 0–1 score, not the rendered meter — and ascending by default,
      // because the least confident verification is the one most needing a human.
      sortValue: (a) => a.conf,
      cell: (a) => <ConfidenceMeter conf={a.conf} threshold={threshold} />,
    },
    {
      id: "flag",
      header: "Flag",
      cell: (a) => <span className="text-xs text-ink-2">{a.flag}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      hideHeader: true,
      cell: (a) => (
        <LinkButton
          variant="outline"
          to={`/ai-review/${a.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          Review
          <ArrowRight data-icon="inline-end" />
        </LinkButton>
      ),
    },
  ];

  const filters: TypedFilterDef<AiFlag>[] = [
    {
      id: "flag",
      label: "Flag",
      variant: "select",
      options: flagOptions,
      match: (a, v) => a.flag === v,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load the AI review queue"
      caption="Verifications flagged for manual review, with the expected and detected serial, match confidence and flag reason"
      data={flags}
      columns={columns}
      getRowId={(a) => a.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      filters={filters}
      defaultSort={{ columnId: "conf", dir: "asc" }}
      onRowClick={(a) => navigate(`/ai-review/${a.id}`)}
      minWidth="55rem"
      // An empty queue is the goal state: every verification cleared the
      // threshold and closed itself. Say that, rather than showing a void.
      emptyIcon={ShieldCheck}
      emptyTitle="Nothing waiting on review"
      emptyDescription={`Every verification cleared the ${threshold}% confidence threshold and went straight to closure.`}
    />
  );
}
