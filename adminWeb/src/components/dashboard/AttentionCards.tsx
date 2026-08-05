import { Link } from "react-router";
import { AlertTriangle, Clock, ScanLine, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttentionItem } from "@/types";

/** Static per-tone classes — an interpolated colour class never compiles. */
const TONE: Record<
  AttentionItem["tone"],
  { icon: LucideIcon; wrap: string; count: string }
> = {
  danger: {
    icon: AlertTriangle,
    wrap: "bg-danger-bg text-danger",
    count: "text-danger",
  },
  ai: {
    icon: ScanLine,
    wrap: "bg-status-ai-review-bg text-status-ai-review",
    count: "text-status-ai-review",
  },
  warn: { icon: ShieldCheck, wrap: "bg-warn-bg text-warn", count: "text-warn" },
  info: { icon: Clock, wrap: "bg-info-bg text-info", count: "text-info" },
};

/** Each row deep-links to the queue that clears it — a work list, not a tally. */
export function AttentionCards({ items }: { items: AttentionItem[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="border-b border-line-2 pb-4">
        <CardTitle className="text-sm">Needs your attention</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-2">
        {items.map((item) => {
          const tone = TONE[item.tone];
          const Icon = tone.icon;
          return (
            <Link
              key={item.key}
              to={item.to}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-md ${tone.wrap}`}
              >
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {item.title}
                </span>
                <span className="block truncate text-xs text-ink-3">
                  {item.sub}
                </span>
              </span>
              <span
                className={`text-[15px] font-semibold tabular-nums ${tone.count}`}
              >
                {item.count}
              </span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
