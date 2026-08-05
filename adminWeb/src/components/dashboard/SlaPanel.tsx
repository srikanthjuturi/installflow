import { Link } from "react-router";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SlaBreakdown } from "@/types";

/** Proportion of open tickets in each SLA state. */
export function SlaPanel({ sla }: { sla: SlaBreakdown }) {
  const total = sla.ok + sla.warn + sla.breach;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  const segments = [
    { key: "ok", label: "On track", n: sla.ok, bar: "bg-ok", dot: "bg-ok" },
    { key: "warn", label: "Due soon", n: sla.warn, bar: "bg-warn", dot: "bg-warn" },
    { key: "breach", label: "Breached", n: sla.breach, bar: "bg-danger", dot: "bg-danger" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">SLA status across open tickets</CardTitle>
        <CardAction>
          <Link
            to="/tickets"
            className="text-brand-400 hover:text-brand-500 text-xs font-semibold"
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
            <div key={s.key} className={s.bar} style={{ width: `${pct(s.n)}%` }} />
          ))}
        </div>

        {/* Each figure is labelled in text — the bar's colour is never the
            only thing carrying the meaning. */}
        <dl className="mt-3.5 flex flex-wrap gap-x-5.5 gap-y-2 text-[13px]">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={`size-2.25 rounded-[2px] ${s.dot}`} aria-hidden />
              <dt>{s.label}</dt>
              <dd className="font-semibold">{s.n}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
