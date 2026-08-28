import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { KIND } from "./kinds";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "@/services/notifications";

/** The control value for "don't narrow by kind" — never sent to the server. */
const ALL = "All";

interface NotificationToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  kind?: NotificationKind;
  onKind: (kind?: NotificationKind) => void;
  unread: boolean;
  onUnread: (unread: boolean) => void;
  isFiltered: boolean;
  onClear: () => void;
  /**
   * How much the filters kept, e.g. "2 of 5 events".
   *
   * Only while something is filtered. Unfiltered, the count is already at the
   * foot of the list and repeating it here puts a number beside the toggle it
   * has nothing to do with — which reads as that toggle's label.
   */
  matchSummary?: string;
  /** Wires the controls to the region they narrow, for assistive tech. */
  listId: string;
}

/**
 * What narrows the feed: a search box, a kind, and unread-only.
 *
 * A select rather than a pill per kind. Five categories plus "all" is six
 * controls that would wrap onto a second line at every width the console is
 * actually used at, and unlike the ticket board's status pills, nobody scans a
 * notification feed BY category — they arrive looking for one thing.
 */
export function NotificationToolbar({
  search,
  onSearch,
  kind,
  onKind,
  unread,
  onUnread,
  isFiltered,
  onClear,
  matchSummary,
  listId,
}: NotificationToolbarProps) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <div className="flex h-10 min-w-55 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search events, tickets, technicians…"
          aria-label="Search notifications"
          aria-controls={listId}
          className="w-full border-none bg-transparent text-[13px] text-ink outline-none"
        />
      </div>

      <Select
        value={kind ?? ALL}
        onValueChange={(v) => onKind(v && v !== ALL ? (v as NotificationKind) : undefined)}
      >
        <SelectTrigger className="h-10 w-52" aria-label="Filter by event type">
          {/* Name the dimension, not just the value — a select reading "All"
              on its own tells you nothing about what it filters. */}
          <SelectValue>
            {kind ? (
              <span>
                <span className="text-ink-3">Type: </span>
                {KIND[kind].label}
              </span>
            ) : (
              <span className="text-ink-3">Type: all</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL}>Type: all</SelectItem>
            {NOTIFICATION_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND[k].label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* A toggle, so its state is announced rather than inferred from a tint. */}
      <button
        type="button"
        aria-pressed={unread}
        aria-controls={listId}
        onClick={() => onUnread(!unread)}
        className={cn(
          "h-10 rounded-md border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
          unread
            ? "border-brand-500 bg-brand-500 text-white"
            : "border-line bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
        )}
      >
        Unread only
      </button>

      {isFiltered ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X data-icon="inline-start" />
          Clear
        </Button>
      ) : null}

      {/* Counts what MATCHES, not what has scrolled into view — a scroll
          position is not a fact about the feed. Announced, because narrowing a
          list to nothing is the one result nobody sees coming. */}
      <p className="text-xs text-ink-3" role="status" aria-live="polite">
        {isFiltered ? matchSummary : null}
      </p>
    </div>
  );
}
