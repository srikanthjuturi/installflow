import { useLocation } from "react-router";

/**
 * Where a detail screen's "Back" should go, carried in router state.
 *
 * A ticket has ONE route but several ways in — the board, a technician's recent
 * jobs, a technician's full list, the portal. A detail screen cannot work out
 * which one you used from the URL, so whoever navigates says so.
 */
export interface NavOrigin {
  backTo: string;
  backLabel: string;
}

/**
 * The current view, packaged as the origin to hand a detail screen.
 *
 * It keeps the query string, so "Back" returns to page 3 of the escalated
 * tickets rather than the top of an unfiltered board — the list you left is the
 * list you come back to.
 *
 * Returns `undefined` when no label is given, so a caller that has not opted in
 * navigates exactly as it did before.
 */
export function useNavOrigin(backLabel?: string): NavOrigin | undefined {
  const { pathname, search } = useLocation();
  return backLabel ? { backTo: pathname + search, backLabel } : undefined;
}

/**
 * Read an origin back off `location.state`.
 *
 * Router state does not survive a reload or a pasted link, so this is allowed
 * to find nothing and every caller needs its own fallback.
 */
export function readNavOrigin(state: unknown): NavOrigin | undefined {
  if (!state || typeof state !== "object") return undefined;
  const { backTo, backLabel } = state as Partial<NavOrigin>;
  return typeof backTo === "string" && typeof backLabel === "string"
    ? { backTo, backLabel }
    : undefined;
}
