/**
 * Longest-prefix route matching, shared by the two portal nav tables (and any
 * future one).
 *
 * Extracted from `vendor/portalNav.ts`, whose private `longestMatch` was the
 * working code: an exact path wins, then anything claimed by an entry's `to`
 * prefix or an explicit `match` entry, longest `to` winning ties. It has to be
 * longest-prefix rather than `NavLink`'s own matching, because entries overlap
 * — "My tickets" is `/portal/tickets` and claims `/portal/tickets/`, which
 * `/portal/tickets/new` sits inside; plain prefix matching lights both, and
 * `end` lights neither on the detail page.
 *
 * In its own module because BOTH portal tables need it and `portalNav.ts` may
 * not grow an import just to stay a table: shared/nav.ts stays the staff rail's
 * home, and this stays the only place two external guard tables meet.
 */
export interface NavMatchItem {
  to: string;
  match?: string[];
}

export function longestMatch<T extends NavMatchItem>(
  items: T[],
  pathname: string
): T | undefined {
  const exact = items.find((i) => i.to === pathname);
  if (exact) return exact;
  return items
    .filter(
      (i) =>
        pathname.startsWith(`${i.to}/`) ||
        i.match?.some((m) => pathname.startsWith(m))
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
}