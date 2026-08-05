import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { FunnelStage } from "@/types";

/** Where the region's tickets currently sit in the flow. */
export function FunnelPanel({ stages }: { stages: FunnelStage[] }) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col justify-center gap-3">
        {stages.map((s, i) => (
          <div key={s.label} className="flex flex-col gap-3">
            {i > 0 && <Separator />}
            <div className="flex items-baseline gap-3">
              <span className="text-[22px] leading-none font-semibold tabular-nums">
                {s.n}
              </span>
              <span className="text-[13px] text-ink-2">{s.label}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
