import { useEffect, useRef } from "react";
import { BellOff, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { groupByDay } from "@/lib/dayGroup";
import { useSession } from "@/store/session";
import { NotificationRow } from "./NotificationRow";
import type { OpsNotification } from "@/services/notifications";

interface NotificationListProps {
  items: OpsNotification[];
  /** How many match the filters, not how many have loaded. */
  total: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onMarkRead: (id: string) => void;
  /** The row currently being marked read, if any. */
  pendingId?: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** Set while a filter is on, so "nothing here" can say why. */
  isFiltered: boolean;
  onClearFilters: () => void;
}

type Rewrite = [prefix: string, rewrite: (path: string) => string];

/**
 * Where each route lands for a PORTAL reader, first match wins.
 *
 * An ordered table rather than a chain of ifs, because the list grows:
 * `vendor_id` widens a notification to a vendor's portal, and six kinds
 * already carry one.
 */
const PORTAL_ROUTES: Rewrite[] = [
  ["/tickets/", (path) => `/portal${path}`],
  // A staff-written route for something a vendor is a party to. `/approvals`
  // is the ops queue; their copy of that product is on their own screen.
  ["/approvals", () => "/portal/products"],
  ["/portal/products", (path) => path],
  // A decision on a brand they added.
  ["/portal/brands", (path) => path],
];

/**
 * The same table in the other direction, for a STAFF reader.
 *
 * It is needed because `vendor_id` on a notification WIDENS the audience and
 * never narrows it: a product decision is written for the vendor and lands in
 * every staff feed too. Without this, a manager clicking one would be sent to
 * `/portal/products`, which `RequirePortal` bounces straight back to `/` — a
 * bell that leads nowhere, which is the one thing a notification must not be.
 */
const OPS_ROUTES: Rewrite[] = [
  ["/portal/products", () => "/approvals"],
  // The Brands half of the same queue.
  ["/portal/brands", () => "/approvals?kind=brands"],
];

/**
 * The server stores ONE route per notification. Most are written for the
 * console; the vendor portal is a separate route tree over the same records, so
 * the same row has to point somewhere else there.
 *
 * Rewritten here rather than stored twice: two columns would have to be kept
 * in step by every writer, and a notification whose two routes disagreed would
 * be worse than one that needed translating.
 *
 * The query string is split off BEFORE matching. The old single rule only
 * handled `/tickets/…` correctly by luck — it prefixed the whole string, so a
 * `?focus=` would have travelled along by accident rather than by design.
 *
 * The fallback stays and is deliberate: a kind this build has never heard of
 * must still land somewhere real, the same reasoning `kindMeta` uses, and the
 * ticket list is the portal's home.
 */
function routeFor(to: string, portal: boolean): string {
  const q = to.indexOf("?");
  const path = q === -1 ? to : to.slice(0, q);
  const query = q === -1 ? "" : to.slice(q);
  const table = portal ? PORTAL_ROUTES : OPS_ROUTES;
  const hit = table.find(([prefix]) => path.startsWith(prefix));
  if (hit) return `${hit[1](path)}${query}`;
  // A portal reader falls back to their home; a staff reader keeps whatever the
  // server wrote, because the ops routes ARE the ones it writes by default.
  return portal ? "/portal/tickets" : to;
}

export function NotificationList({
  items,
  total,
  isLoading,
  error,
  onRetry,
  onOpen,
  onMarkRead,
  pendingId,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isFiltered,
  onClearFilters,
}: NotificationListProps) {
  const portal = useSession((s) => s.portal);

  // Auto-load on scroll, with the button below as the real control. The
  // observer is the convenience; the button is what a keyboard reaches, and
  // what somebody gets when the observer never fires because the list is
  // shorter than the viewport.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && fetchNextPage(),
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (error)
    return (
      <ErrorState
        title="Couldn't load notifications"
        error={error}
        onRetry={onRetry}
      />
    );

  if (isLoading) return <NotificationSkeleton />;

  if (items.length === 0)
    return isFiltered ? (
      <EmptyState
        icon={SearchX}
        title="No events match"
        description="Nothing in this feed matches what you're looking for."
        action={
          <Button variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={BellOff}
        title="No events yet"
        description="Escalations, AI flags, force-close candidates and slot timeouts land here."
      />
    );

  const groups = groupByDay(items, (n) => n.createdAt);

  return (
    <>
      {/* One list of days, each holding its own events, so the divider is the
          heading of the rows under it rather than a sibling that happens to sit
          above them. Screen readers get the same grouping the eye does. */}
      <ul>
        {groups.map((group) => (
          <li key={group.key}>
            {/* Sticky under the topbar: on a feed spanning weeks the day you
                are reading scrolls off long before you reach the end of it.
                Full-bleed (`-mx-2`) so rows pass behind it, text at `px-5` so
                it still lines up with the icon column. */}
            <h3 className="sticky top-topbar z-10 -mx-2 bg-card/95 px-5 py-2 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase backdrop-blur-sm">
              {group.label}
            </h3>
            {/* Spaced rather than divided. Each event is its own thing to act
                on, and the unread tint is a filled block — butted together they
                read as one shaded region instead of four separate items. */}
            <ul className="space-y-1.5 pb-3">
              {group.items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  to={routeFor(n.to, portal)}
                  onOpen={onOpen}
                  onMarkRead={onMarkRead}
                  busy={pendingId === n.id}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div ref={sentinel} className="h-px" aria-hidden />

      <div className="flex flex-col items-center gap-2 px-3 pt-3 pb-1">
        {hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchNextPage}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage && <Spinner data-icon="inline-start" />}
            {isFetchingNextPage
              ? "Loading…"
              : `Load more (${(total - items.length).toLocaleString("en-IN")} left)`}
          </Button>
        ) : (
          // A feed that just stops looks like a feed that failed to load the
          // rest. Saying where the end is costs one line.
          <p className="text-xs text-ink-3">
            That's everything — {items.length.toLocaleString("en-IN")}{" "}
            {items.length === 1 ? "event" : "events"}.
          </p>
        )}
      </div>
    </>
  );
}

/** Matches the real row's shape so nothing jumps when the feed lands. */
function NotificationSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <Skeleton className="mx-3 my-2 h-3 w-16" />
      <ul>
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-3">
            <Skeleton className="size-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-56 max-w-full" />
              <Skeleton className="mt-2 h-3 w-40 max-w-full" />
            </div>
            <Skeleton className="h-3 w-14 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}
