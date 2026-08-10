import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `foreground/10` (not `bg-muted`) so the shimmer is actually visible:
      // --muted is #f7f8fb, all but invisible on a white card. A tint of the
      // ink colour reads clearly on both the light and dark surfaces.
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
      {...props}
    />
  );
}

export { Skeleton };
