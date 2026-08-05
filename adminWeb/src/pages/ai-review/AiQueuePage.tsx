import { ScanLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageMeta } from "@/components/shared/PageMeta";
import { AiQueueTable } from "@/components/ai-review/AiQueueTable";
import { AI_CONFIDENCE_THRESHOLD, useAiQueue } from "@/hooks/useAiReview";

export default function AiQueuePage() {
  const { data, isLoading, isError, error, refetch } = useAiQueue();
  const hasRows = Boolean(data?.length);

  return (
    <>
      <PageMeta
        title="AI review queue"
        description="Verifications flagged for manual review."
      />

      {hasRows ? (
        <p className="bg-status-ai-review-bg text-status-ai-review mb-3.5 flex items-center gap-2.5 rounded-md px-4 py-3.25 text-[13px]">
          <ScanLine className="size-4.5 shrink-0" aria-hidden />
          <span>
            AI verification flagged these tickets for manual review. Below the{" "}
            <b>{AI_CONFIDENCE_THRESHOLD}%</b> confidence threshold or with an unreadable
            image.
          </span>
        </p>
      ) : null}

      <Card>
        <CardContent className="px-0">
          <AiQueueTable
            flags={data}
            threshold={AI_CONFIDENCE_THRESHOLD}
            isLoading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    </>
  );
}
