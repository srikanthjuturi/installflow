import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageMeta } from "@/components/shared/PageMeta";
import { NotificationList } from "@/components/notifications/NotificationList";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/useNotifications";

/**
 * The bell's destination. Same four events the dashboard counts, as a feed:
 * escalations, AI verification flags, force-close candidates and slot timeouts.
 */
export default function NotificationsPage() {
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = data?.filter((n) => !n.read).length ?? 0;

  return (
    <>
      <PageMeta
        title="Notifications"
        description="Recent escalations, AI flags, force-close candidates and slot timeouts."
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Recent events</h2>
          <p className="text-xs text-ink-3">
            {isLoading
              ? "Loading…"
              : unread === 0
                ? "Nothing unread"
                : `${unread} unread`}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {markAll.isPending ? "Marking…" : "Mark all as read"}
        </Button>
      </div>

      <Card>
        <CardContent className="px-2">
          <NotificationList
            items={data}
            isLoading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
            onMarkRead={(id) => markRead.mutate(id)}
            pendingId={markRead.isPending ? markRead.variables : undefined}
          />
        </CardContent>
      </Card>
    </>
  );
}
