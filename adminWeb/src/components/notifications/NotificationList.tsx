import { Link } from "react-router";
import {
  AlertTriangle,
  BellOff,
  Check,
  Clock,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { cn } from "@/lib/utils";
import type {
  NotificationKind,
  OpsNotification,
} from "@/services/notifications";

/** Static per-kind classes — an interpolated colour class never compiles. */
const KIND: Record<
  NotificationKind,
  { icon: LucideIcon; wrap: string; label: string }
> = {
  escalation: {
    icon: AlertTriangle,
    wrap: "bg-danger-bg text-danger",
    label: "Escalation",
  },
  ai: {
    icon: ScanLine,
    wrap: "bg-status-ai-review-bg text-status-ai-review",
    label: "AI verification",
  },
  "force-close": {
    icon: ShieldCheck,
    wrap: "bg-warn-bg text-warn",
    label: "Force closure",
  },
  slot: { icon: Clock, wrap: "bg-info-bg text-info", label: "Slot" },
};

interface NotificationListProps {
  items?: OpsNotification[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onMarkRead: (id: string) => void;
  /** The row currently being marked read, if any. */
  pendingId?: string;
}

export function NotificationList({
  items,
  isLoading,
  error,
  onRetry,
  onMarkRead,
  pendingId,
}: NotificationListProps) {
  if (error)
    return (
      <ErrorState
        title="Couldn't load notifications"
        error={error}
        onRetry={onRetry}
      />
    );

  if (isLoading) return <NotificationSkeleton />;

  if (!items?.length)
    return (
      <EmptyState
        icon={BellOff}
        title="No events yet"
        description="Escalations, AI flags, force-close candidates and slot timeouts land here."
      />
    );

  return (
    <ul className="divide-y divide-line-2">
      {items.map((n) => {
        const kind = KIND[n.kind];
        const Icon = kind.icon;
        return (
          <li key={n.id} className="flex items-center gap-2">
            {/* The row navigates to the screen that clears the event. */}
            <Link
              to={n.to}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-2"
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md",
                  kind.wrap
                )}
              >
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {/* Unread is stated in words, not signalled by weight alone. */}
                  <span
                    className={cn(
                      "truncate text-[13px]",
                      n.read ? "font-medium text-ink-2" : "font-semibold"
                    )}
                  >
                    {n.title}
                  </span>
                  {n.read ? null : (
                    <span className="shrink-0 rounded-full bg-brand-100 px-2 py-px text-[10px] font-bold tracking-[0.04em] text-brand-500 uppercase">
                      Unread
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-3">
                  {kind.label} · {n.detail}
                </span>
              </span>
              <span className="shrink-0 text-xs whitespace-nowrap text-ink-3">
                {n.when}
              </span>
            </Link>

            {/* Acting on the row, not going anywhere — so a Button. */}
            {n.read ? (
              <span className="hidden w-24 shrink-0 items-center gap-1 px-2 text-xs text-ink-3 sm:flex">
                <Check className="size-3.5" aria-hidden />
                Read
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-24 shrink-0"
                disabled={pendingId === n.id}
                onClick={() => onMarkRead(n.id)}
              >
                Mark read
                <span className="sr-only"> · {n.title}</span>
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Matches the real row's shape so nothing jumps when the feed lands. */
function NotificationSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line-2">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-3">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="mt-2 h-3 w-40 max-w-full" />
          </div>
          <Skeleton className="h-3 w-14 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
