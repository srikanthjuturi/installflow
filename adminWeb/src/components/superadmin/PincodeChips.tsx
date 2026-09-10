import { useEffect, useRef } from "react";
import { MapPinned } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useInfinitePincodes } from "@/hooks/useGeo";
import { cn } from "@/lib/utils";
import type { PincodeFilters } from "@/services/geo";
import type { GeoPincode } from "@/types/geo";

interface Props {
  filters: PincodeFilters;
  search: string;
  /** Names what is being listed, for the count line and the empty state. */
  scopeLabel: string;
  /**
   * The district being listed, when there is one.
   *
   * Set it and the chips go compact: printing "Adilabad" under all 168 of
   * Adilabad's pincodes says nothing the heading has not already said. What is
   * worth saying is the exception — the codes that ALSO reach another district
   * — so those get a marker and the rest get one clean line.
   */
  currentDistrict?: string;
  /**
   * Name the state on each chip. Set above state level, where the district
   * alone does not identify a pincode: searching "Bilaspur" returns 46 codes
   * across TWO Bilaspurs — one in Himachal, one in Chhattisgarh — and without
   * the state they are indistinguishable. Five district names repeat this way.
   */
  showState?: boolean;
  /**
   * Open the edit dialog on a chip. Optional, so this stays presentational —
   * only the Geography screen can write, and it is the only caller that passes
   * it.
   */
  onEdit?: (pincode: GeoPincode) => void;
}

/**
 * The leaf of the drill-down: pincodes as chips, a page at a time.
 *
 * Chips rather than a table because there is exactly one fact per row — the
 * code — and a one-column table of 2,041 rows is a worse way to look at 2,041
 * six-digit numbers than a wrapped block of them. Each chip names its districts
 * underneath, which is the only other thing a pincode carries and the thing
 * that explains why some appear under two districts.
 */
export function PincodeChips({
  filters,
  search,
  scopeLabel,
  currentDistrict,
  showState,
  onEdit,
}: Props) {
  const query = useInfinitePincodes(search, filters);
  const { rows, total, isPending, isError, error, refetch } = query;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  // Auto-load on scroll, with the button below as the real control. The
  // observer is the convenience; the button is what a keyboard reaches.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && fetchNextPage(),
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load pincodes"
        error={error}
        onRetry={() => refetch()}
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 24 }).map((_, i) => (
          <Skeleton key={i} className="h-[42px] w-[76px] rounded-md" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MapPinned}
        title="No pincodes here"
        description={
          search
            ? `Nothing in ${scopeLabel} matches "${search}".`
            : `${scopeLabel} holds no pincodes in the master.`
        }
      />
    );
  }

  return (
    <>
      <p className="mb-3 text-[12px] text-ink-3">
        Showing {rows.length.toLocaleString()} of{" "}
        <span className="font-medium text-ink-2">{total.toLocaleString()}</span>{" "}
        in {scopeLabel}
      </p>

      <ul className="flex flex-wrap gap-1.5">
        {rows.map((pincode) => {
          const others = currentDistrict
            ? pincode.districts.filter((d) => d !== currentDistrict)
            : pincode.districts;

          const body = (
            <>
              <span
                className={cn(
                  "text-[13px] font-semibold tabular-nums text-ink",
                  !pincode.isActive && "line-through"
                )}
              >
                {pincode.code}
              </span>

              {/* Marked, never hidden. This is the one screen that can switch a
                  pincode back on, so a switched-off code has to be reachable
                  here even though every picker has stopped offering it. */}
              {!pincode.isActive && (
                <span className="rounded bg-surface-3 px-1 py-px text-[10px] font-medium text-ink-2">
                  Off
                </span>
              )}

              {currentDistrict ? (
                others.length > 0 && (
                  <span
                    className="rounded bg-surface-3 px-1 py-px text-[10px] font-medium text-ink-2"
                    title={`Also in ${others.join(", ")}`}
                  >
                    <span aria-hidden>+{others.length}</span>
                    <span className="sr-only">also in {others.join(", ")}</span>
                  </span>
                )
              ) : (
                <span className="max-w-56 truncate text-[11px] text-ink-3">
                  {showState && (
                    <span className="font-medium text-ink-2">
                      {pincode.stateName}
                    </span>
                  )}
                  {showState && " · "}
                  {/* Four pincodes nationally belong to no district. Saying so
                      beats a blank that reads as a rendering fault. */}
                  {pincode.districts.length > 0
                    ? pincode.districts.join(" · ")
                    : "No district"}
                </span>
              )}
            </>
          );

          const chip =
            "flex w-full items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 leading-tight";

          return (
            <li key={pincode.code}>
              {onEdit ? (
                // The whole chip, rather than a pencil beside it: there is one
                // fact per chip and no room for a second control, and the
                // approved layout is what a superadmin already reads.
                <button
                  type="button"
                  onClick={() => onEdit(pincode)}
                  aria-label={`Edit ${pincode.code}`}
                  className={cn(
                    chip,
                    "bg-surface-2 text-left transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    !pincode.isActive && "opacity-70"
                  )}
                >
                  {body}
                </button>
              ) : (
                <span className={cn(chip, "bg-surface-2")}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>

      <div ref={sentinel} className="h-px" aria-hidden />

      {hasNextPage && (
        <div className="mt-3.5 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage && <Spinner data-icon="inline-start" />}
            {isFetchingNextPage
              ? "Loading…"
              : `Load more (${(total - rows.length).toLocaleString()} left)`}
          </Button>
        </div>
      )}
    </>
  );
}
