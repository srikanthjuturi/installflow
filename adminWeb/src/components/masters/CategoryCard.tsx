import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Microwave,
  Package,
  Refrigerator,
  Tv,
  WashingMachine,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category } from "@/types";

/** The prototype draws a per-category glyph; these are the lucide equivalents. */
const ICONS: Record<string, LucideIcon> = {
  Television: Tv,
  Refrigerator: Refrigerator,
  "Washing Machine": WashingMachine,
  "Air Conditioner": AirVent,
  Microwave: Microwave,
};

export function CategoryCard({ category }: { category: Category }) {
  const Icon = ICONS[category.name] ?? Package;

  return (
    <Card className="gap-0 py-4.5">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="bg-brand-100 text-brand-500 grid size-9.5 shrink-0 place-items-center rounded-lg"
            >
              <Icon className="size-4.5" />
            </div>
            <div>
              <h2 className="text-[15px] leading-snug font-semibold">{category.name}</h2>
              <p className="text-ink-3 text-xs">
                {category.techs} technicians certified
              </p>
            </div>
          </div>

          {/* Never colour alone — the state is spelled out. */}
          <span
            className={
              category.active
                ? "text-ok bg-ok-bg shrink-0 rounded-full px-2.25 py-0.75 text-[11px] font-semibold"
                : "text-warn bg-warn-bg shrink-0 rounded-full px-2.25 py-0.75 text-[11px] font-semibold"
            }
          >
            {category.active ? "Active" : "Paused"}
          </span>
        </div>

        <div className="mt-4">
          <h3 className="text-ink-3 mb-2 text-[11px] font-bold tracking-[0.05em] uppercase">
            Product models ({category.models.length})
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {category.models.map((m) => (
              <li
                key={m}
                className="bg-surface-3 text-ink-2 rounded-md px-2.75 py-1.25 text-xs font-medium"
              >
                {m}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/** Loading in the real card's shape — never a spinner. */
export function CategoryCardSkeleton() {
  return (
    <Card className="gap-0 py-4.5">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9.5 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
          <Skeleton className="h-4.5 w-14 rounded-full" />
        </div>
        <div className="mt-4">
          <Skeleton className="mb-2 h-3 w-28" />
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-6.5 w-24 rounded-md" />
            <Skeleton className="h-6.5 w-28 rounded-md" />
            <Skeleton className="h-6.5 w-20 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
