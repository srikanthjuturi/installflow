import { Link } from "react-router";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relativeTime";
import { formatDateTime } from "@/utils/datetime";
import { cn } from "@/lib/utils";
import { kindMeta } from "./kinds";
import type { OpsNotification } from "@/services/notifications";

interface NotificationRowProps {
  notification: OpsNotification;
  /** Where the row navigates — already rewritten for the surface it is on. */
  to: string;
  /** Opening it IS reading it; the row reports both with one call. */
  onOpen: (id: string) => void;
  onMarkRead: (id: string) => void;
  busy?: boolean;
}

/**
 * One event, as a row.
 *
 * The whole row is the link, because the useful thing to do with a notification
 * is deal with it, and a link that is only the title is a target people miss.
 * The dismiss control sits OUTSIDE that link rather than inside it — a button
 * nested in an anchor is invalid, and browsers resolve it by firing both.
 */
export function NotificationRow({
  notification: n,
  to,
  onOpen,
  onMarkRead,
  busy,
}: NotificationRowProps) {
  const kind = kindMeta(n.kind);
  const Icon = kind.icon;
  const unread = !n.read;

  return (
    <li
      className={cn(
        "group relative flex items-center gap-1 rounded-lg transition-colors",
        unread ? "bg-brand-100/60" : "hover:bg-surface-2"
      )}
    >
      {/* Decorative — every fact it hints at is also written out below. */}
      {unread ? (
        <span
          className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand-500"
          aria-hidden
        />
      ) : null}

      <Link
        to={to}
        onClick={() => unread && onOpen(n.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <span
              className={cn(
                "truncate text-[13px]",
                unread ? "font-semibold text-ink" : "font-medium text-ink-2"
              )}
            >
              {n.title}
            </span>
            {/* Unread is stated in words, never carried by the tint and the
                weight alone — both are invisible to somebody reading one row
                at a time. */}
            {unread ? (
              <span className="shrink-0 rounded-full bg-brand-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-brand-500">
                Unread
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            <span className="font-medium text-ink-2">{kind.label}</span> ·{" "}
            {n.detail}
          </span>
        </span>

        {/* Relative for reading at a glance, exact on hover — "21h ago" is the
            useful form and the only one that ages correctly, but somebody
            writing an incident note needs the timestamp. */}
        <time
          dateTime={n.createdAt}
          title={formatDateTime(n.createdAt)}
          className="shrink-0 text-xs whitespace-nowrap text-ink-3 tabular-nums"
        >
          {relativeTime(n.createdAt)}
        </time>
      </Link>

      {/* Acting on the row rather than going anywhere, so a Button. Kept for
          the events somebody has handled elsewhere and only needs off the list;
          opening one already marks it. */}
      <span className="flex w-9 shrink-0 justify-center pr-1">
        {unread ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-ink-3 hover:text-ink"
            disabled={busy}
            title="Mark read"
            aria-label={`Mark read · ${n.title}`}
            onClick={() => onMarkRead(n.id)}
          >
            <Check aria-hidden />
          </Button>
        ) : (
          <span className="grid size-8 place-items-center">
            <Check className="size-4 text-ink-3/60" aria-hidden />
            <span className="sr-only">Read</span>
          </span>
        )}
      </span>
    </li>
  );
}
