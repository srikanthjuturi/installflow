import { cn } from "@/lib/utils";
import { formatTotal, RESULT_TARGETS } from "./resultTargets";
import type { SearchGroup, SearchType } from "@/types/search";

interface SearchScopePillsProps {
  groups: SearchGroup[];
  scope: SearchType | null;
  onScope: (scope: SearchType | null) => void;
}

/**
 * Which slice of the results the panel is showing.
 *
 * Built from the groups the server actually returned, so a pill never leads to
 * a blank panel — a type the caller cannot see, or that this term does not
 * match, has no pill at all.
 *
 * Styling is the approved filter pill from `DataTable/Toolbar`, at panel scale.
 */
export function SearchScopePills({
  groups,
  scope,
  onScope,
}: SearchScopePillsProps) {
  if (groups.length < 2) return null;

  return (
    // Sideways rather than wrapping: on a phone six pills would take three rows
    // and leave no panel underneath them.
    <div
      className="scroll-slim flex gap-1.5 overflow-x-auto border-b border-line px-2 pb-2"
      role="group"
      aria-label="Filter results by type"
    >
      <Pill active={scope === null} onClick={() => onScope(null)}>
        All
      </Pill>
      {groups.map((group) => (
        <Pill
          key={group.type}
          active={scope === group.type}
          onClick={() => onScope(group.type)}
        >
          {RESULT_TARGETS[group.type].label}
          <span className="ms-1 opacity-70">
            {formatTotal(group.total, group.capped)}
          </span>
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      // Keeps the caret in the search box: without this the pointer-down blurs
      // the input, which closes the popup the pill lives in before the click
      // ever lands. Tab still reaches these, so the keyboard path is unaffected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "h-7 shrink-0 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors",
        active
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-line bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
