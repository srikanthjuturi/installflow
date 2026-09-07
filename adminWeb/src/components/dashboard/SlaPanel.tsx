import { Link } from "react-router";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FunnelStage, SlaBreakdown, SlaHrefs } from "@/types";

interface SlaPanelProps {
  sla: SlaBreakdown;
  /** Where each bucket leads. Composed in `services/dashboard.ts` — see `SlaHrefs`. */
  slaHrefs: SlaHrefs;
  stages: FunnelStage[];
  /** The board, still narrowed to whatever the dashboard is showing. */
  ticketsHref: string;
}

/**
 * SLA proportion across open tickets, with the flow funnel beneath it —
 * the same card: "how healthy is the queue" and "where is it sitting".
 */
export function SlaPanel({
  sla,
  slaHrefs,
  stages,
  ticketsHref,
}: SlaPanelProps) {
  const total = sla.ok + sla.warn + sla.breach;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  const segments = [
    { key: "ok", label: "On track", n: sla.ok, tint: "bg-ok", to: slaHrefs.ok },
    {
      key: "warn",
      label: "Due soon",
      n: sla.warn,
      tint: "bg-warn",
      to: slaHrefs.warn,
    },
    {
      key: "breach",
      label: "Breached",
      n: sla.breach,
      tint: "bg-danger",
      to: slaHrefs.breach,
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="border-b border-line-2 pb-4">
        <CardTitle className="text-sm">
          SLA status across open tickets
        </CardTitle>
        <CardAction>
          <Link
            to={ticketsHref}
            className="text-xs font-semibold text-brand-400 hover:text-brand-500"
          >
            View all →
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        {/* Nothing open is a real answer, and it became a common one when the
            filters landed: a territory or a date range can legitimately match
            no tickets. Three zero-width segments render as a bare rounded
            strip that reads as a chart that failed to draw, so the empty case
            gets its own filled bar in the "no data" step and says so. */}
        {total === 0 ? (
          <div
            className="flex h-3.5 overflow-hidden rounded-lg bg-chart-empty"
            role="img"
            aria-label="No open tickets to report an SLA breakdown for"
          />
        ) : (
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
        )}

        {/* Every figure is written out — the bar's colour is never the only
            thing carrying the meaning.

            Links rather than a `<dl>`: each one opens the board filtered to
            that bucket, on the same `slaState` rank the segment was measured
            with. The bar itself stays a picture — a 2%-wide segment is not a
            click target, and its aria-label already reads the whole breakdown
            out, so nothing is lost by making the legend the way in. */}
        <div className="mt-3.5 flex flex-wrap gap-x-5.5 gap-y-2 text-[13px]">
          {segments.map((s) => (
            // The negative margins cancel the padding exactly, so each link's
            // margin box is the size the old bare row was: the hit area grows,
            // the approved spacing does not move.
            <Link
              key={s.key}
              to={s.to}
              className="-mx-1.5 -my-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={`size-2.25 rounded-[2px] ${s.tint}`}
                aria-hidden
              />
              <span>{s.label}</span>
              <span className="font-semibold">{s.n}</span>
            </Link>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stages.map((s) => {
            const box =
              "rounded-md border border-line-2 bg-surface-2 px-3.5 py-3.25";
            const inner = (
              <>
                <div className="text-[23px] leading-none font-semibold tabular-nums">
                  {s.n}
                </div>
                <div className="mt-1.5 text-xs text-ink-2">{s.label}</div>
              </>
            );
            // Same rule as the KPI tiles: a stage with no honest destination
            // renders as the plain box it always was, rather than pretending.
            return s.to ? (
              <Link
                key={s.label}
                to={s.to}
                className={`${box} transition-colors outline-none hover:border-brand-400 focus-visible:ring-2 focus-visible:ring-ring`}
              >
                {inner}
              </Link>
            ) : (
              <div key={s.label} className={box}>
                {inner}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
