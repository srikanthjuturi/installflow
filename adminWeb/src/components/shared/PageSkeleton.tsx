import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level Suspense fallback — a shape, never a spinner or a blank page.
 *
 * Deliberately neutral: a toolbar row over one content panel, which reads as
 * "a screen is loading" for any route. The old 4-card grid looked like the
 * dashboard and was misleading on the many list/table screens.
 */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-10 max-w-xl flex-1 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
