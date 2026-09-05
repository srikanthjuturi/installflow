import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { Kpi } from "@/types";

/**
 * Static per-count classes — an interpolated `xl:grid-cols-${n}` is never
 * generated and the row would collapse to one column.
 *
 * Keyed on how many tiles arrive rather than hard-wired to four, because the
 * count is now a decision `services/dashboard.ts` makes: the AI-flagged tile is
 * commented out while that slice is unbuilt, and a fixed `xl:grid-cols-4` left
 * a fourth empty seat on every wide screen. Uncommenting it widens the row
 * back on its own.
 */
const COLS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
};

export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3.5 sm:grid-cols-2",
        COLS[kpis.length] ?? "xl:grid-cols-4"
      )}
    >
      {kpis.map((k) => (
        <Card key={k.key}>
          <CardContent className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-medium text-ink-2">{k.label}</div>
              {/* No chip rather than an empty one: a blank pill reads as a
                  figure that failed to load. Nothing records what these counts
                  were yesterday, so there is no movement to show — see `Kpi`. */}
              {k.delta ? (
                <span
                  className={cn(
                    "rounded-full px-1.75 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                    k.good ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"
                  )}
                >
                  {k.delta}
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight">
              {k.value}
            </div>
            <div className="mt-1.5 text-xs text-ink-3">{k.sub}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
