/**
 * The DOM id of one node of the product master, at any level.
 *
 * The whole tree renders expanded, so a global-search hit does not have to open
 * anything to reach its row — `CategoriesPage` scrolls to this id when it
 * arrives with `?focus=`. Its own module so the page and the tree cannot
 * disagree about the spelling, and so `CategoryTree.tsx` goes on exporting
 * components only.
 */
export function masterNodeId(id: string): string {
  return `master-${id}`;
}
