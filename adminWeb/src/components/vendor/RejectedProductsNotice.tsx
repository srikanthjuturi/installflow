import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/plural";
import type { ProductModel, ProductNode } from "@/types/product";

export interface RejectedProduct {
  node: ProductNode;
  model: ProductModel;
}

/**
 * The products a National Head sent back, and why.
 *
 * Pinned above the tree rather than left to the chip's tooltip. A tooltip is
 * unreachable by touch and by keyboard, and the reason is the single most
 * important string on this screen for the person who has to act on it — it is
 * the whole of what they were told.
 *
 * A rejection is a WORK ITEM; the tree below is a browsing surface, and a work
 * item that only exists inside a hover is one nobody does. The same reasoning
 * as `NarrowedNotice` on the escalation queue.
 *
 * The chip in the tree still carries the word "Rejected", so the two surfaces
 * agree about what is true.
 */
export function RejectedProductsNotice({
  rejected,
  onEdit,
}: {
  rejected: RejectedProduct[];
  onEdit: (item: RejectedProduct) => void;
}) {
  if (!rejected.length) return null;

  return (
    <section
      aria-labelledby="rejected-heading"
      className="mb-3.5 rounded-md border border-warn/30 bg-warn-bg p-3.5"
    >
      <h3
        id="rejected-heading"
        className="flex items-center gap-2 text-sm font-semibold text-warn"
      >
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {plural(rejected.length, "product")}{" "}
        {rejected.length === 1 ? "needs" : "need"} a change
      </h3>

      <ul className="mt-2.5 grid gap-2">
        {rejected.map(({ node, model }) => (
          <li
            key={model.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-surface px-3 py-2.5"
          >
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-medium">{model.name}</div>
              <div className="text-xs text-ink-3">
                {node.path.join(" › ")}
              </div>
              {model.rejectionReason ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-2">
                  {model.rejectionReason}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEdit({ node, model })}
            >
              Edit and resubmit
              <span className="sr-only"> {model.name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
