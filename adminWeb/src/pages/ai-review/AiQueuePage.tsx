import { ScanLine } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { AiQueueTable } from "@/components/ai-review/AiQueueTable";
import { useAiQueue, useAiThreshold } from "@/hooks/useAiReview";

export default function AiQueuePage() {
  const threshold = useAiThreshold();
  const { data, isLoading, isError, error, refetch } = useAiQueue();
  const hasRows = Boolean(data?.length);

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
        flags={data}
        threshold={threshold}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
      />
    </>
  );
}
