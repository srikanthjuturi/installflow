import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { Kpi } from "@/types";

export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => (
        <Card key={k.key}>
          <CardContent className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-medium text-ink-2">{k.label}</div>
              <span
                className={cn(
                  "rounded-full px-1.75 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                  k.good ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"
                )}
              >
                {k.delta}
              </span>
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
