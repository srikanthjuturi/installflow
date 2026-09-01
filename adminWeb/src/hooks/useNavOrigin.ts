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
  /**
   * The origin the page at `backTo` was ITSELF reached with, so a trail more
   * than one hop deep comes back the way it went in.
   *
   * Without it, escalations → ticket → assign walks back to the ticket having
   * forgotten the queue, and the second Back lands on the board — a screen the
   * reader never visited. A back button is a claim about where somebody came
   * from, so it has to survive as many hops as the reader took.
   *
   * The value is handed to `Link`'s `state` on the way back, which is the same
   * channel that carried it in.
   */
  backState?: NavOrigin;
}

/**
 * The current view, packaged as the origin to hand a detail screen.
 *
 * It keeps the query string, so "Back" returns to page 3 of the escalated
 * tickets rather than the top of an unfiltered board — the list you left is the
 * list you come back to.
 *
 * `backState` is this page's OWN origin, forwarded so the next screen can hand
 * it back. A list screen has none and passes nothing; a detail screen in the
 * middle of a trail passes what it was given.
 *
 * Returns `undefined` when no label is given, so a caller that has not opted in
 * navigates exactly as it did before.
 */
export function useNavOrigin(
  backLabel?: string,
  backState?: NavOrigin
): NavOrigin | undefined {
  const { pathname, search } = useLocation();
  if (!backLabel) return undefined;
  return backState
    ? { backTo: pathname + search, backLabel, backState }
    : { backTo: pathname + search, backLabel };
}

/**
 * Read an origin back off `location.state`.
 *
 * Router state does not survive a reload or a pasted link, so this is allowed
 * to find nothing and every caller needs its own fallback.
 *
 * Recursive, because `backState` is an origin too — and validated at every
 * level rather than trusted: `location.state` is whatever the last navigation
 * put there, including a shape from a build that has since been deployed over.
 */
export function readNavOrigin(state: unknown): NavOrigin | undefined {
  if (!state || typeof state !== "object") return undefined;
  const { backTo, backLabel, backState } = state as Partial<NavOrigin>;
  if (typeof backTo !== "string" || typeof backLabel !== "string") {
    return undefined;
  }
  const parent = readNavOrigin(backState);
  return parent ? { backTo, backLabel, backState: parent } : { backTo, backLabel };
}

/**
 * The origin to hand the page at `path` when navigating there.
 *
 * Usually the one we hold — but if it points AT that page, handing it over
 * would give the reader a back button to the page they are already on. Its
 * parent is what belongs there instead.
 *
 * This is what an action screen uses on success: assigning a technician from
 * the escalation queue lands on the ticket, and that ticket's Back should still
 * read "Back to escalations". Reached from the ticket itself, the same screen
 * hands over whatever the ticket was holding.
 */
export function originFor(
  path: string,
  origin: NavOrigin | undefined
): NavOrigin | undefined {
  if (!origin) return undefined;
  // Compared without the query string: `backTo` carries the filters of the
  // list it names, and `/tickets/x` is the same page as `/tickets/x?tab=proof`.
  return origin.backTo.split("?")[0] === path ? origin.backState : origin;
}
