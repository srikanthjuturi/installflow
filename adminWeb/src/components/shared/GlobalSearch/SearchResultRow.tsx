import { Autocomplete } from "@base-ui/react/autocomplete";
import { RESULT_TARGETS } from "./resultTargets";
import type { SearchHit } from "@/types/search";

interface SearchResultRowProps {
  hit: SearchHit;
  /**
   * Position in the FLAT list of visible rows. Passed explicitly so Base UI
   * does not have to recover it from the DOM — the list is rebuilt on every
   * keystroke and grows a page at a time under the cursor.
   */
  index: number;
  onSelect: (hit: SearchHit) => void;
}

/**
 * One result. Title, a line of context, an optional chip.
 *
 * `onClick` on a Base UI item fires for a pointer click AND for Enter while the
 * row is highlighted, so navigation has one handler rather than two that could
 * drift.
 *
 * `hover` as well as `data-highlighted`, the same pairing `ui/combobox.tsx`
 * documents: Base UI drives `data-highlighted` from pointer MOVEMENT, so a
 * stationary cursor over a list that just grew by a page would otherwise show
 * no feedback at all under the pointer.
 */
export function SearchResultRow({ hit, index, onSelect }: SearchResultRowProps) {
  const Icon = RESULT_TARGETS[hit.type].icon;

  return (
    <Autocomplete.Item
      value={hit}
      index={index}
      onClick={() => onSelect(hit)}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors outline-none select-none hover:bg-accent focus:bg-accent data-highlighted:bg-accent"
    >
      <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[13px] font-medium text-ink">
          {hit.title}
        </span>
        {hit.subtitle ? (
          <span className="truncate text-xs text-ink-3">{hit.subtitle}</span>
        ) : null}
      </span>
      {hit.badge ? (
        <span className="shrink-0 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-2">
          {hit.badge}
        </span>
      ) : null}
    </Autocomplete.Item>
  );
}
