import type { LucideIcon } from "lucide-react";
import { AlertCircle, Inbox, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Td, Tr } from "./DataTable";

/* -------------------------------------------------------------------------
   Every list screen ships all three of these. Not optional.
   ---------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function ErrorState({
  title = "Couldn't load this",
  error,
  onRetry,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Something went wrong. Try again.";

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertCircle className="text-danger" aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {/* Never colour alone — the icon and the words both carry the failure. */}
        <EmptyDescription role="alert">{message}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" onClick={onRetry}>
            <RotateCw data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

/** Matches the real table's shape so nothing jumps when data lands. */
export function TableSkeleton({
  rows = 6,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <Tr key={r} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((__, c) => (
            <Td key={c}>
              <Skeleton
                className="h-4"
                style={{ width: c === 0 ? "70%" : "55%" }}
              />
            </Td>
          ))}
        </Tr>
      ))}
    </>
  );
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
