import { Check, Lock, MessageSquare, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/utils/datetime";
import type { TimelineEvent } from "@/types";

/**
 * Static per-kind classes — an interpolated colour class never compiles.
 *
 * The keys are the event kinds the API actually stores, not the seven the mock
 * invented. They grow as the slices that write them land.
 */
const EVENT: Record<TimelineEvent["kind"], { icon: LucideIcon; tint: string }> = {
  created: { icon: Plus, tint: "bg-status-new-bg text-status-new" },
  slot_requested: { icon: MessageSquare, tint: "bg-info-bg text-info" },
  slot_confirmed: {
    icon: Lock,
    tint: "bg-status-ai-review-bg text-status-ai-review",
  },
  status_changed: { icon: Check, tint: "bg-ok-bg text-ok" },
};

/**
 * The audit trail. Every closure and escalation has to be answerable for
 * later — who did what, when, and on what basis — so this is a record, not
 * decoration. Rendered as an ordered list because the sequence is the point.
 */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-line-2 pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          Timeline &amp; audit trail
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-3">
            {events.length} events
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col">
          {events.map((e, i) => {
            const meta = EVENT[e.kind] ?? EVENT.created;
            const Icon = meta.icon;
            const isLast = i === events.length - 1;
            return (
              <li key={`${e.title}-${i}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full ${meta.tint}`}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  {!isLast && (
                    <span
                      className="min-h-4 w-0.5 flex-1 bg-line-2"
                      aria-hidden
                    />
                  )}
                </div>
                <div className={isLast ? "pb-0" : "pb-4"}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold">{e.title}</span>
                    <span className="text-[11px] text-ink-3">{formatDateTime(e.at)}</span>
                  </div>
                  {(e.note || e.by) && (
                    <p className="mt-0.5 text-xs text-ink-2">
                      {e.note}
                      {e.note && e.by ? " · " : null}
                      {e.by && <span className="text-ink-3">by {e.by}</span>}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
