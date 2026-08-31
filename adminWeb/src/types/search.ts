/**
 * Global search — one row shape for every entity.
 *
 * The API answers in a single hit shape rather than five, so the panel draws a
 * result the same way whatever it points at and needs no per-type branch. What
 * differs per type is where the row GOES, and that lives on the client — see
 * `components/shared/GlobalSearch/resultTargets.ts`.
 */

/** The searchable entities, and the path segment of the drill-down route. */
export type SearchType =
  | "ticket"
  | "technician"
  | "user"
  | "vendor"
  | "product";

export interface SearchHit {
  id: string;
  type: SearchType;
  title: string;
  subtitle: string | null;
  badge: string | null;
}

export interface SearchGroup {
  type: SearchType;
  /** Matches found, counted no further than the server's cap. See `capped`. */
  total: number;
  /**
   * The count stopped at the cap, so the real total is "at least `total`".
   * Rendered `99+` — a bounded count, not a number anybody invented.
   */
  capped: boolean;
  items: SearchHit[];
}

/** Groups with no hits are omitted, so this list IS the set of scope pills. */
export interface SearchPreview {
  groups: SearchGroup[];
}

/** The shortest term the server will answer. Below it, nothing is requested. */
export const MIN_SEARCH_TERM = 2;
