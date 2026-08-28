import { ArrowLeft, CheckCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { AlertSettings } from "@/components/notifications/AlertSettings";
import { NotificationList } from "@/components/notifications/NotificationList";
import { NotificationToolbar } from "@/components/notifications/NotificationToolbar";
import { readNavOrigin } from "@/hooks/useNavOrigin";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useNotificationFilters } from "@/hooks/useNotificationFilters";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationFeed,
  useUnreadNotificationCount,
} from "@/hooks/useNotifications";
import { landingPath, useSession } from "@/store/session";

const LIST_ID = "notification-feed";

/**
 * The bell's destination. The same four kinds of event the dashboard counts —
 * escalations, AI verification flags, force-close candidates and slot timeouts
 * — as a feed somebody works through.
 *
 * Three things make it a working screen rather than a list of the last few
 * things that happened: it is searchable and filterable (and that view is in
 * the URL, so it can be handed to a colleague), it pages rather than stopping
 * at the most recent handful, and OPENING an event reads it — nobody should
 * have to tell the console twice that they have dealt with something.
 */
export default function NotificationsPage() {
  const { filters, search, kind, unread, isFiltered, patch, clear } =
    useNotificationFilters();

  // Only the request waits; the box itself is controlled by the URL and
  // repaints on every keystroke.
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const feed = useNotificationFeed({ ...filters, search: debouncedSearch });

  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  return (
    <>
      <PageMeta
        title="Notifications"
        description="Recent escalations, AI flags, force-close candidates and slot timeouts."
      />

      {/* Above the feed rather than buried under it: the reader who scrolls
          this list is exactly the reader who would rather not have to hear
          about the next one this way. */}
      <AlertSettings />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        {/* The way out sits where a section heading would. There is no heading
            to lose: the topbar already says "Notifications · Recent operational
            events", and repeating that underneath it was a line whose only job
            was to name the page you were already on. */}
        <div className="flex items-center gap-3">
          <BackButton />
          {/* The bell's own count, not the filtered feed's — this answers "how
              much is waiting for me", which a filter must not change. */}
          <p className="text-xs text-ink-3">
            {unreadCount === 0 ? "Nothing unread" : `${unreadCount} unread`}
          </p>
        </div>
        <Button
          variant="outline"
          // Same reason as TerritoryPage: `outline` on a page background has
          // no visible boundary — see the note there.
          className="border-brand-400 bg-surface text-brand-500 hover:bg-brand-100"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck data-icon="inline-start" />
          {markAll.isPending ? "Marking…" : "Mark all as read"}
        </Button>
      </div>

      <NotificationToolbar
        search={search}
        onSearch={(value) => patch({ search: value })}
        kind={kind}
        onKind={(next) => patch({ kind: next })}
        unread={unread}
        onUnread={(next) => patch({ unread: next })}
        isFiltered={isFiltered}
        onClear={clear}
        matchSummary={
          feed.isPending
            ? "Searching…"
            : `${feed.total.toLocaleString("en-IN")} ${
                feed.total === 1 ? "event" : "events"
              } match`
        }
        listId={LIST_ID}
      />

      <Card className="overflow-visible">
        <CardContent className="px-2" id={LIST_ID}>
          <NotificationList
            items={feed.rows}
            total={feed.total}
            isLoading={feed.isPending}
            error={feed.isError ? feed.error : null}
            onRetry={() => feed.refetch()}
            onOpen={(id) => markRead.mutate(id)}
            onMarkRead={(id) => markRead.mutate(id)}
            pendingId={markRead.isPending ? markRead.variables : undefined}
            hasNextPage={feed.hasNextPage}
            isFetchingNextPage={feed.isFetchingNextPage}
            fetchNextPage={() => feed.fetchNextPage()}
            isFiltered={isFiltered}
            onClearFilters={clear}
          />
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The way back out. Always the one word.
 *
 * It does NOT name where it goes. The bell is in the topbar, so this page is
 * reached from every screen in the console — a label that named the last one
 * would read differently on every visit, and "Back to Tickets" beside a feed of
 * escalations describes the history stack rather than anything on screen.
 *
 * Where it goes still varies, in order of how much is actually known: an origin
 * handed over in router state (a real href, so it opens in a new tab and shows
 * its destination); failing that, browser history, which `location.key` tells us
 * exists; and failing THAT — a pasted link, a fresh tab — the surface's own
 * landing page, because a "Back" that leaves the app is not a way back.
 */
function BackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const { superadmin, portal } = useSession();

  const origin = readNavOrigin(location.state);
  if (origin) {
    return (
      <LinkButton variant="ghost" size="sm" className="-ml-2" to={origin.backTo}>
        <ArrowLeft data-icon="inline-start" />
        Back
      </LinkButton>
    );
  }

  // "default" is react-router's key for an entry it did not create — the first
  // page of the session. There is nothing behind it to go back to.
  if (location.key !== "default") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>
    );
  }

  return (
    <LinkButton
      variant="ghost"
      size="sm"
      className="-ml-2"
      to={landingPath({ superadmin, portal })}
    >
      <ArrowLeft data-icon="inline-start" />
      Back
    </LinkButton>
  );
}
