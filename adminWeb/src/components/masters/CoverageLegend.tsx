import { cn } from "@/lib/utils";

/**
 * What a colour means on the Territory map.
 *
 * These are the reserved STATUS colours, used for an actual status — covered,
 * not covered, not yours — rather than borrowed as a categorical palette. That
 * is the one legitimate use of `ok` / `warn`, and it is why the map does not
 * reuse Geography's four region hues: the question here is "where are the
 * holes", and a hole has to out-shout everything else on the page.
 *
 * Every entry carries a label and a count, so colour is never the only
 * encoding — and the panel beside the map lists the same states as text.
 */
export interface CoverageCounts {
  covered: number;
  unassigned: number;
  outside: number;
}

const KEYS = [
  {
    key: "covered" as const,
    swatch: "bg-ok",
    label: "Covered",
    hint: "an area manager holds it",
  },
  {
    key: "unassigned" as const,
    swatch: "bg-warn",
    label: "No area manager",
    hint: "no technician is eligible here",
  },
  {
    key: "outside" as const,
    swatch: "bg-surface-3 ring-1 ring-line ring-inset",
    label: "Outside your territory",
    hint: "shown for context, not actionable",
  },
];

export function CoverageLegend({ counts }: { counts: CoverageCounts }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {KEYS.map((k) =>
        // A zero row is dropped: "Outside your territory 0" is noise for a
        // national head, who has no outside.
        counts[k.key] === 0 ? null : (
          <li key={k.key} className="flex items-center gap-1.5 text-[11px]">
            <span className={cn("size-2.5 shrink-0 rounded-[3px]", k.swatch)} aria-hidden />
            <span className="font-medium text-ink">{k.label}</span>
            <span className="tabular-nums text-ink-3">{counts[k.key]}</span>
            <span className="hidden text-ink-3 sm:inline">— {k.hint}</span>
          </li>
        )
      )}
    </ul>
  );
}
