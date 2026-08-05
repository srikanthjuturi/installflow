import { Skeleton } from "@/components/ui/skeleton";

/** Route-level Suspense fallback — a shape, never a spinner or a blank page. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
