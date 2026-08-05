import { Link } from "react-router";
import { AlertTriangle, Clock, ScanLine, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { AttentionItem } from "@/types";

/** Static per-tone classes — an interpolated colour class never compiles. */
const TONE: Record<AttentionItem["tone"], { icon: LucideIcon; wrap: string }> = {
  danger: { icon: AlertTriangle, wrap: "bg-danger-bg text-danger" },
  ai: { icon: ScanLine, wrap: "bg-status-ai-review-bg text-status-ai-review" },
  warn: { icon: ShieldCheck, wrap: "bg-warn-bg text-warn" },
  info: { icon: Clock, wrap: "bg-info-bg text-info" },
};

export function AttentionCards({ items }: { items: AttentionItem[] }) {
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="mb-3 text-sm font-semibold">
        Needs your attention
      </h2>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const tone = TONE[item.tone];
          const Icon = tone.icon;
          return (
            <Card key={item.key} className="hover:border-brand-400 transition-colors">
              <CardContent>
                <Link to={item.to} className="flex items-center gap-3 outline-none">
                  <span className={`grid size-9.5 shrink-0 place-items-center rounded-md ${tone.wrap}`}>
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{item.title}</span>
                    <span className="text-ink-3 block truncate text-xs">{item.sub}</span>
                  </span>
                  <span className="text-xl font-semibold tabular-nums">{item.count}</span>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
