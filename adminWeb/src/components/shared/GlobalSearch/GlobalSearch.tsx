import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  isSearchable,
  useGlobalSearch,
  useGlobalSearchType,
} from "@/hooks/useGlobalSearch";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { cn } from "@/lib/utils";
import { useRecentlySeen } from "@/store/recentlySeen";
import { MIN_SEARCH_TERM } from "@/types/search";
import type { SearchHit, SearchType } from "@/types/search";
import { SearchResultRow } from "./SearchResultRow";
import { SearchScopePills } from "./SearchScopePills";
import { formatTotal, RESULT_TARGETS } from "./resultTargets";

/** Approved prototype copy — the one string here that was not written for this. */
const PLACEHOLDER = "Search tickets, technicians…";

/** Rows shown per group before the panel offers to drill in. */
const PREVIEW_ROWS = 5;

/** Start fetching this far from the bottom, so the next page lands unnoticed. */
const SCROLL_RUNWAY_PX = 64;

/**
 * The topbar search.
 *
 * Two states in one panel. It opens on a PREVIEW — the top few of every type,
 * so a technician is never buried under four hundred tickets — and drills into
 * one type as a flat list that pages in as you scroll.
 *
 * Mounted in `Topbar`, which renders only inside `AppShell`. The vendor portal
 * and the superadmin surface have their own headers and deliberately do not get
 * this; the API refuses both anyway.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const origin = useNavOrigin("Back");

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** Small screens only: the bar is a button until it is asked for. */
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<SearchType | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const term = useDebouncedValue(query, 300);

  /**
   * A stale scope must not survive into a different search — the type it names
   * may have no hits at all for the new term, which would open on a blank panel.
   *
   * Adjusted during render rather than in an effect: React re-runs this
   * component before committing, so the drill-down query is never even created
   * for the wrong term. An effect would let one render, and therefore one
   * request, go out under the old scope first.
   */
  const [scopeTerm, setScopeTerm] = useState(term);
  if (scopeTerm !== term) {
    setScopeTerm(term);
    setScope(null);
  }
  const activeScope = scopeTerm === term ? scope : null;

  const preview = useGlobalSearch(term);
  const drill = useGlobalSearchType(term, activeScope);

  const groups = useMemo(() => preview.data?.groups ?? [], [preview.data]);
  const searching = isSearchable(query);

  const recent = useRecentlySeen();
  /**
   * The trail, as hits, so it goes through the same row and the same keyboard
   * handling as a result. `badge: null` on purpose — a stored status would be
   * whatever it was when you last looked, which for a ticket is exactly the
   * thing that moves while you are not looking.
   */
  const recentHits: SearchHit[] = useMemo(
    () =>
      recent.items.map((item) => ({
        type: item.type,
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        badge: null,
      })),
    [recent.items]
  );

  /**
   * Every visible row, in the order they appear.
   *
   * Base UI navigates and highlights over this flat list, so it has to match
   * what is on screen exactly — including across group boundaries and the
   * recently-seen list, or ↓ would skip a heading's worth of rows.
   */
  const rows: SearchHit[] = useMemo(() => {
    if (activeScope) return drill.rows;
    if (!searching) return recentHits;
    return groups.flatMap((g) => g.items);
  }, [activeScope, searching, drill.rows, groups, recentHits]);

  const { record } = recent;
  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      setExpanded(false);
      inputRef.current?.blur();
      // Following a result is seeing it. The detail screens record too, so a
      // ticket opened from the board also lands here — but a user, a vendor or
      // a product has no detail screen, and this is the only place they can be
      // recorded from.
      record({
        type: hit.type,
        id: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
      });
      navigate(RESULT_TARGETS[hit.type].to(hit), { state: origin });
    },
    [navigate, origin, record]
  );

  const focusInput = useCallback(() => {
    setExpanded(true);
    // The bar may only be mounting now on a small screen.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // ⌘K / Ctrl+K and `/` reach the box from anywhere. Nothing else in the app
  // claims either; the only other global shortcut is bare `D` for dark mode,
  // and that one already ignores keystrokes aimed at an input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isCommandK = (event.metaKey || event.ctrlKey) && event.key === "k";
      const isSlash =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableTarget(event.target);
      if (!isCommandK && !isSlash) return;
      event.preventDefault();
      focusInput();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusInput]);

  /**
   * Page in as the end of the list comes into view.
   *
   * An IntersectionObserver on a sentinel row, NOT a scroll handler. A scroll
   * handler only fires when there is something to scroll, so a first page that
   * does not fill the panel — a short list, a tall row, a small window — would
   * leave the rest of the results permanently unreachable. This fires on
   * visibility, so a list that never overflows still pages itself in.
   *
   * Re-created when the row count changes, because an observer reports
   * CHANGES: if the sentinel is still on screen after a page lands, a
   * long-lived observer would go quiet and the chain would stall one page in.
   */
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = drill;
  const rowCount = rows.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !activeScope) return;
    if (!hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      // A page of runway, so the next one lands before the user reaches the end.
      { root, rootMargin: `0px 0px ${SCROLL_RUNWAY_PX}px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeScope, hasNextPage, isFetchingNextPage, fetchNextPage, rowCount]);

  const active = activeScope ? drill : preview;
  const short = query.trim().length > 0 && !searching;
  const settling = searching && term !== query.trim();

  // An empty box is worth opening only when there is a trail to show. With no
  // history and nothing typed, the panel would be a blank rectangle.
  const canOpen = query.trim().length > 0 || recentHits.length > 0;

  return (
    <>
      {/* Below `md` the bar is a button until it is wanted — at 360px there is
          no room for it beside the hamburger, the company switcher and the
          bell. Above it, the button is what the bar replaces. */}
      {!expanded ? (
        <Button
          variant="outline"
          size="icon"
          className="rounded-full md:hidden"
          aria-label="Search"
          onClick={focusInput}
        >
          <Search aria-hidden />
        </Button>
      ) : null}

      <Autocomplete.Root
        // The server filtered; filtering again in the browser would hide a hit
        // whose title does not literally contain what was typed — a ticket
        // found by its serial, for instance.
        mode="none"
        items={rows}
        value={query}
        onValueChange={setQuery}
        // Base UI writes the chosen item back into the input, and there is no
        // prop to turn that off — an Autocomplete assumes the item IS the
        // answer. Here it is a destination, so the box would be left holding a
        // stringified hit and would immediately search for it. Emptying it says
        // the search is over, which it is: we have navigated away.
        itemToStringValue={() => ""}
        open={open && canOpen}
        onOpenChange={setOpen}
        autoHighlight
      >
        <div
          ref={barRef}
          className={cn(
            "h-9.5 items-center gap-2 rounded-full border border-line bg-surface-2 px-3.5 text-ink-3",
            // Grows with the window, capped so the topbar stays balanced and
            // the results panel lands near the eye rather than off at the edge.
            "md:flex md:min-w-44 md:flex-1 md:max-w-xl",
            expanded
              ? // Small screens: the bar takes the row, over the page title.
                "absolute inset-x-3 z-20 flex bg-surface md:static md:inset-auto md:bg-surface-2"
              : "hidden"
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <Autocomplete.Input
            ref={inputRef}
            type="search"
            placeholder={PLACEHOLDER}
            aria-label={PLACEHOLDER}
            onFocus={() => setOpen(true)}
            onBlur={() => setExpanded(false)}
            // `type="search"` for the semantics; its native clear button is
            // hidden because on a small screen it lands right beside our own
            // close button and reads as two X's that do different things.
            className="w-full min-w-0 border-none bg-transparent text-[13px] text-ink outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-3 lg:inline">
            ⌘K
          </kbd>
          {expanded ? (
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setExpanded(false);
                setOpen(false);
              }}
              className="shrink-0 text-ink-3 transition-colors hover:text-ink md:hidden"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <Autocomplete.Portal>
          <Autocomplete.Positioner
            className="isolate z-50 outline-none"
            sideOffset={6}
            align="end"
            // The BAR, not the input Base UI would pick by itself. The input
            // sits inside the icon and the ⌘K chip, so anchoring to it made the
            // panel narrower than the control and visibly out of line with it.
            anchor={barRef}
          >
            <Autocomplete.Popup className="w-(--anchor-width) min-w-64 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover pt-2 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
              {/* `keepPreviousData` means the last search's groups survive a
                  cleared box, so the pills are hidden explicitly — filtering a
                  history list by the previous term's types is meaningless. */}
              <SearchScopePills
                groups={searching ? groups : []}
                scope={activeScope}
                onScope={setScope}
              />

              {/* Only the results scroll; the pills stay put, or the way back
                  to "All" would disappear the moment you scrolled. */}
              <div
                ref={scrollRef}
                className="scroll-slim max-h-[26rem] overflow-y-auto p-1"
              >
                {!searching ? (
                  /* Nothing worth searching yet, so the panel offers the way
                     back to what you were last looking at. The hint sits above
                     it rather than replacing it: one character is a moment on
                     the way to a search, not an error worth a whole panel. */
                  <>
                    {short ? (
                      <p className="px-2 pt-1 pb-2 text-xs text-ink-3">
                        Keep typing — at least {MIN_SEARCH_TERM} characters.
                      </p>
                    ) : null}
                    <div className="flex items-center justify-between px-2 pt-1 pb-1">
                      <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                        Recently seen
                      </p>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={recent.clear}
                        className="text-[11px] font-semibold text-ink-3 transition-colors hover:text-danger"
                      >
                        Clear
                      </button>
                    </div>
                    <Autocomplete.List>
                      {rows.map((hit, index) => (
                        <SearchResultRow
                          key={`${hit.type}:${hit.id}`}
                          hit={hit}
                          index={index}
                          onSelect={go}
                        />
                      ))}
                    </Autocomplete.List>
                  </>
                ) : active.isPending || settling ? (
                  <ResultsSkeleton />
                ) : active.isError ? (
                  <div className="px-2 py-3">
                    <p className="text-xs text-ink-2">
                      Couldn&apos;t run the search.
                    </p>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void active.refetch()}
                      className="mt-1 text-xs font-semibold text-brand-500 hover:text-brand-400"
                    >
                      Retry
                    </button>
                  </div>
                ) : rows.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-ink-3">
                    No matches for &ldquo;{term.trim()}&rdquo;
                  </p>
                ) : (
                  <Autocomplete.List>
                    {activeScope ? (
                      <>
                        {rows.map((hit, index) => (
                          <SearchResultRow
                            key={`${hit.type}:${hit.id}`}
                            hit={hit}
                            index={index}
                            onSelect={go}
                          />
                        ))}
                        {/* What the observer watches. It sits after the rows,
                            so coming into view means the end of the list is
                            in reach. */}
                        <div ref={sentinelRef} aria-hidden />
                        {/* A visible end to the list: a panel that has stopped
                            growing must not look like one still fetching. */}
                        {drill.isFetchingNextPage ? (
                          <p className="px-2 py-2 text-xs text-ink-3">
                            Loading more…
                          </p>
                        ) : null}
                      </>
                    ) : (
                      groups.map((group) => (
                        <div key={group.type} className="pb-1">
                          <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                            {RESULT_TARGETS[group.type].label}
                          </p>
                          {group.items.map((hit) => (
                            <SearchResultRow
                              key={`${hit.type}:${hit.id}`}
                              hit={hit}
                              index={rows.indexOf(hit)}
                              onSelect={go}
                            />
                          ))}
                          {group.total > PREVIEW_ROWS ? (
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setScope(group.type)}
                              className="px-2 py-1.5 text-xs font-semibold text-brand-500 hover:text-brand-400"
                            >
                              Show all {formatTotal(group.total, group.capped)}{" "}
                              →
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </Autocomplete.List>
                )}
              </div>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </>
  );
}

/** Shaped like real rows — an icon, two lines, a chip — never a spinner. */
function ResultsSkeleton() {
  return (
    <div className="space-y-1 p-1" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-2.5 px-1 py-1.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <div className="grid flex-1 gap-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Is the keystroke already going somewhere that wants it?
 *
 * The same test `theme-provider` applies before acting on bare `D`. Bare `/`
 * needs it for the same reason: it is a real character inside a text field.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}
