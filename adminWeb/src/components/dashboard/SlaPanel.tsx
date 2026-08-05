import { Link } from "react-router";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FunnelStage, SlaBreakdown } from "@/types";

interface SlaPanelProps {
  sla: SlaBreakdown;
  stages: FunnelStage[];
}

/**
 * SLA proportion across open tickets, with the flow funnel beneath it —
 * the same card: "how healthy is the queue" and "where is it sitting".
 */
export function SlaPanel({ sla, stages }: SlaPanelProps) {
  const total = sla.ok + sla.warn + sla.breach;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  const segments = [
    { key: "ok", label: "On track", n: sla.ok, tint: "bg-ok" },
    { key: "warn", label: "Due soon", n: sla.warn, tint: "bg-warn" },
    { key: "breach", label: "Breached", n: sla.breach, tint: "bg-danger" },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="border-b border-line-2 pb-4">
        <CardTitle className="text-sm">
          SLA status across open tickets
        </CardTitle>
        <CardAction>
          <Link
            to="/tickets"
            className="text-xs font-semibold text-brand-400 hover:text-brand-500"
          >
            View all →
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div
          className="flex h-3.5 overflow-hidden rounded-lg"
          role="img"
          aria-label={`SLA breakdown of ${total} open tickets: ${segments
            .map((s) => `${s.n} ${s.label.toLowerCase()}`)
            .join(", ")}`}
        >
          {segments.map((s) => (
            <div
              key={s.key}
              className={s.tint}
              style={{ width: `${pct(s.n)}%` }}
            />
          ))}
        </div>

        {/* Every figure is written out — the bar's colour is never the only
            thing carrying the meaning. */}
        <dl className="mt-3.5 flex flex-wrap gap-x-5.5 gap-y-2 text-[13px]">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className={`size-2.25 rounded-[2px] ${s.tint}`}
                aria-hidden
              />
              <dt>{s.label}</dt>
              <dd className="font-semibold">{s.n}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stages.map((s) => (
            <div
              key={s.label}
              className="rounded-md border border-line-2 bg-surface-2 px-3.5 py-3.25"
            >
              <div className="text-[23px] leading-none font-semibold tabular-nums">
                {s.n}
              </div>
              <div className="mt-1.5 text-xs text-ink-2">{s.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
