/**
 * The arithmetic behind the coverage tree — pure, so it can be tested without
 * a browser. The selection is a flat list of 6-digit pincodes owned by the
 * parent form; a node's state is only ever DERIVED from counts the server
 * gives, never stored.
 */

/** What the API accepts for one technician. */
export const MAX_COVERAGE_PINCODES = 500;

export type NodeState = "unchecked" | "checked" | "mixed";

/** A node with nothing to pick can never read as ticked. */
export function nodeState(
  selectedCount: number,
  pincodeCount: number
): NodeState {
  if (pincodeCount <= 0 || selectedCount <= 0) return "unchecked";
  return selectedCount >= pincodeCount ? "checked" : "mixed";
}

/** The next value of a node's box: a half-ticked node ticks the rest. */
export function nextNodeChecked(state: NodeState): boolean {
  return state !== "checked";
}

export interface AddResult {
  next: string[];
  /** Codes that were not already selected. */
  added: number;
  /** True when adding would pass the cap — `next` is then the input, unchanged. */
  overLimit: boolean;
  /** How many the selection would hold had it been allowed. */
  wouldBe: number;
}

/** Union, order kept (existing first), refused wholesale past `max`. */
export function addCodes(
  selected: readonly string[],
  codes: readonly string[],
  max = MAX_COVERAGE_PINCODES
): AddResult {
  const have = new Set(selected);
  const fresh: string[] = [];
  for (const c of codes) {
    if (!have.has(c)) {
      have.add(c);
      fresh.push(c);
    }
  }
  if (have.size > max) {
    return {
      next: [...selected],
      added: 0,
      overLimit: true,
      wouldBe: have.size,
    };
  }
  return {
    next: fresh.length ? [...selected, ...fresh] : [...selected],
    added: fresh.length,
    overLimit: false,
    wouldBe: have.size,
  };
}

/** Everything but `codes`. */
export function removeCodes(
  selected: readonly string[],
  codes: readonly string[]
): string[] {
  const drop = new Set(codes);
  return selected.filter((c) => !drop.has(c));
}

/** One pincode's box. Ticking past the cap is refused like `addCodes`. */
export function toggleCode(
  selected: readonly string[],
  code: string,
  max = MAX_COVERAGE_PINCODES
): AddResult {
  if (selected.includes(code)) {
    return {
      next: removeCodes(selected, [code]),
      added: 0,
      overLimit: false,
      wouldBe: selected.length - 1,
    };
  }
  return addCodes(selected, [code], max);
}

/** Sorted, comma-joined — the debounced key the tree query is asked with. */
export function selectionKey(selected: readonly string[]): string {
  return [...selected].sort().join(",");
}

/** "Over by N" copy needs the number; never negative. */
export function overBy(count: number, max = MAX_COVERAGE_PINCODES): number {
  return Math.max(0, count - max);
}

/** Case-insensitive name filter used by the search box. */
export function matchesName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}
