import { cn } from "@/lib/utils";
import type { PartRequest } from "@/types/parts";
import { partStatusClass, partStatusLabel } from "./partStatus";

/**
 * A request's status as a pill — the word always rides with the tint, never the
 * tint alone (WCAG 1.4.1). Static classes come from `partStatus.ts`.
 */
export function PartStatusBadge({
  request,
}: {
  request: Pick<PartRequest, "status" | "rejectedAfterApproval">;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        partStatusClass(request.status)
      )}
    >
      {partStatusLabel(request)}
    </span>
  );
}
