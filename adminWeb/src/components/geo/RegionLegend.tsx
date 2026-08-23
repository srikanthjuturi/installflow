import { cn } from "@/lib/utils";
import type { GeoRegion } from "@/types/geo";
import { toneFor } from "./regionTone";

interface Props {
  regions: GeoRegion[];
  selectedRegionId?: string;
  onSelect: (regionId: string | null) => void;
}

/**
 * The five regions, as the India map's key and its filter at once.
 *
 * It lived inside `IndiaMap` until Territory needed the same map with a
 * completely different key — coverage, not region. Meaning belongs to the page,
 * so the map takes a legend slot and this fills it on Geography.
 *
 * Colour is never the only encoding: every chip carries the region's name and
 * its state count, and the panel beside the map repeats all of it as text.
 */
export function RegionLegend({ regions, selectedRegionId, onSelect }: Props) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {regions.map((region) => {
        const isActive = region.id === selectedRegionId;
        const empty = region.stateCount === 0;
        return (
          <li key={region.id}>
            <button
              type="button"
              // Clicking the region already showing clears it, so the whole
              // country is one click away without hunting for a crumb.
              onClick={() => onSelect(isActive ? null : region.id)}
              disabled={empty}
              aria-pressed={isActive}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                empty && "cursor-default opacity-60",
                isActive
                  ? "border-ink/25 bg-surface-3"
                  : "border-transparent hover:bg-surface-2"
              )}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-[3px]",
                  toneFor(region.code).swatch,
                  empty && "ring-1 ring-line ring-inset"
                )}
                aria-hidden
              />
              <span
                className={cn("text-ink", isActive ? "font-semibold" : "font-medium")}
              >
                {region.name}
              </span>
              <span className="text-ink-3 tabular-nums">
                {empty ? "empty" : region.stateCount}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
