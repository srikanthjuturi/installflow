import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCheck,
  Coins,
  Lock,
  MessageSquare,
  PencilLine,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Star,
  Undo2,
  UserCheck,
  UserX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  confirmation_sent: { icon: MessageSquare, tint: "bg-info-bg text-info" },
  status_changed: { icon: Check, tint: "bg-ok-bg text-ok" },
  assigned: { icon: UserCheck, tint: "bg-brand-100 text-brand-500" },
  started: { icon: Play, tint: "bg-info-bg text-info" },
  feedback_requested: { icon: MessageSquare, tint: "bg-info-bg text-info" },
  completed: { icon: CheckCheck, tint: "bg-ok-bg text-ok" },
  feedback_received: { icon: Star, tint: "bg-ok-bg text-ok" },
  // Both red, and deliberately: the customer said it was not done, or the unit
  // on site was not the unit on the order. Neither is a step forward.
  reopened: { icon: RotateCcw, tint: "bg-danger-bg text-danger" },
  serial_mismatch: { icon: AlertTriangle, tint: "bg-danger-bg text-danger" },
  serial_corrected: { icon: PencilLine, tint: "bg-warn-bg text-warn" },
  // Routine and system-sent — the quietest tint here, because a timeline where
  // everything is coloured is one where nothing stands out.
  reminded: { icon: BellRing, tint: "bg-surface-3 text-ink-2" },
  // Nobody accepted and the slot was close, so the job left the pool. Red with
  // `reopened` and `serial_mismatch`: a customer is holding a confirmed time
  // that the system could not fill on its own.
  escalated: { icon: AlertTriangle, tint: "bg-danger-bg text-danger" },
  // Money spent to fill it. `ok`-toned rather than red — this is the recovery,
  // and the row above it is already carrying the alarm.
  bonus_added: { icon: Coins, tint: "bg-ok-bg text-ok" },
  // The technician gave the job back. Amber, not red: it costs them and it
  // costs the customer a wait, but they SAID so, and the whole point of the
  // penalty bands is that saying so is worth something.
  released: { icon: Undo2, tint: "bg-warn-bg text-warn" },
  // Nobody said anything and nobody came. The only row here that describes a
  // customer who has already been stood up.
  no_show: { icon: UserX, tint: "bg-danger-bg text-danger" },
};

/**
 * The audit trail. Every closure and escalation has to be answerable for
 * later — who did what, when, and on what basis — so this is a record, not
 * decoration. Rendered as an ordered list because the sequence is the point.
 *
 * ## Why it has a refresh button when it is already live
 *
 * `useTicketStream` invalidates this ticket on `ticket.changed`, so entries
 * normally appear on their own. The button is not the mechanism and is not a
 * confession that the socket is unreliable — it is what someone reaches for
 * during the minute they are watching a job land, when "has anything happened
 * yet" is a question they want answered NOW rather than whenever.
 *
 * Icon-only on purpose. Neither prototype has a refresh control anywhere, so
 * there is no approved string for one (hard rule 6); a labelled button here
 * would be invented copy sitting in the most audit-sensitive card on the page.
 * The `aria-label` is the accessible name, not visible text.
 */
export function Timeline({
  events,
  onRefresh,
  isRefreshing = false,
}: {
  events: TimelineEvent[];
  /** Omitted on any surface that has no query to re-read. */
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-line-2 pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          Timeline &amp; audit trail
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-3">
            {events.length} events
          </span>
        </CardTitle>
        {onRefresh ? (
          <CardAction className="self-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh the timeline"
              onClick={onRefresh}
              // Disabled while in flight so a second click cannot queue a
              // second read of a query that is already fetching.
              disabled={isRefreshing}
            >
              <RotateCw
                className={isRefreshing ? "animate-spin" : undefined}
                aria-hidden
              />
            </Button>
          </CardAction>
        ) : null}
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
