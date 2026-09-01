import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface LoadMoreProps {
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage: () => void;
  /**
   * Plural noun for the button — "escalations", "transactions". It is what
   * makes the control readable out of context, which is exactly the context a
   * screen reader reaches it in.
   */
  label: string;
  className?: string;
}

/**
 * The bottom of an infinite list: an invisible sentinel that loads the next
 * page on scroll, and a real button under it.
 *
 * **Both, always.** The observer is the convenience; the button is what a
 * keyboard reaches, and what somebody gets when the observer never fires
 * because the loaded rows are shorter than the viewport. An infinite list with
 * only a sentinel is a list a keyboard user cannot finish reading.
 *
 * Extracted from the notification feed, which had the only copy of this and is
 * now the third screen to want it. The pattern was already being retyped; a
 * second copy would have been the one that forgot the button.
 *
 * Renders nothing at the end of the list — no "that's everything" line. The
 * lists that use this are worked from the top, and a terminator would be the
 * last thing on screen after the row that actually matters.
 */
export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  label,
  className,
}: LoadMoreProps) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && fetchNextPage(),
      // Ahead of the fold, so the next page is usually already there by the
      // time the reader arrives at the end of this one.
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!hasNextPage) return null;

  return (
    <>
      <div ref={sentinel} className="h-px" aria-hidden />
      <div className={cn("flex justify-center py-4", className)}>
        <Button
          variant="outline"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              Loading…
            </>
          ) : (
            `Load more ${label}`
          )}
        </Button>
      </div>
    </>
  );
}
