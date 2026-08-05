import { useState } from "react";
import { ScanLine } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { AiQueueTable } from "@/components/ai-review/AiQueueTable";
import {
  useAiFlagReasons,
  useAiQueue,
  useAiThreshold,
} from "@/hooks/useAiReview";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

export default function AiQueuePage() {
  const threshold = useAiThreshold();

  // Ascending confidence by default: the least confident verification is the
  // one most needing a human, so it leads the queue.
  const [params, setParams] = useState<ListParams>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
    sortBy: "conf",
    sortDir: "asc",
  });

  // Merged into the current query, not swapped for it — "Clear filters" resets
  // several things at once, and a replacing setter would let the last win.
  const applyParams = (next: ListParams) =>
    setParams((prev) => ({
      ...prev,
      ...next,
      filters: { ...prev.filters, ...next.filters },
    }));

  const { data, isLoading, isError, error, refetch } = useAiQueue(params);
  const reasons = useAiFlagReasons();

  // The whole queue, not this page — the banner is about what is waiting, and
  // page 2 of a flagged queue is still a flagged queue.
  const hasRows = Boolean(data?.pagination.totalRecords);

  return (
    <>
      <PageMeta
        title="AI review queue"
        description="Verifications flagged for manual review."
      />

      {hasRows ? (
        <p className="mb-3.5 flex items-center gap-2.5 rounded-md bg-status-ai-review-bg px-4 py-3.25 text-[13px] text-status-ai-review">
          <ScanLine className="size-4.5 shrink-0" aria-hidden />
          <span>
            AI verification flagged these tickets for manual review. Below the{" "}
            <b>{threshold}%</b> confidence threshold or with an unreadable
            image.
          </span>
        </p>
      ) : null}

      <AiQueueTable
        flags={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={applyParams}
        flagReasons={reasons.data ?? []}
        threshold={threshold}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
      />
    </>
  );
}
