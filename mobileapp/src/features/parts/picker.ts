import type { CataloguePart, PartRequest } from '@/features/parts/types';

/** The "Other — not on the list" row's selection value. Not a UUID, so it can't clash. */
export const OTHER = '__other__';
export const MAX_OTHER = 120;
export const MAX_NOTE = 500;

/** Exactly one of `sparePartId` / `otherName` — the server's 422 otherwise. */
export type PartRequestBody =
  | { sparePartId: string; otherName: null; note: string | null }
  | { sparePartId: null; otherName: string; note: string | null };

/** Trim, case-insensitive substring; blank → everything. Order is the server's. */
export function filterParts(parts: CataloguePart[], query: string): CataloguePart[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return parts;
  return parts.filter((p) => p.name.toLowerCase().includes(needle));
}

/**
 * The request to send, or null while the selection is not sendable yet — the
 * submit button's disabled state reads this, so it can never offer a POST the
 * server's validators would refuse.
 */
export function buildPartRequest(
  selected: string | null,
  otherName: string,
  note: string,
): PartRequestBody | null {
  if (!selected) return null;
  const trimmedNote = note.trim();
  if (trimmedNote.length > MAX_NOTE) return null;
  const cleanNote = trimmedNote === '' ? null : trimmedNote;

  if (selected === OTHER) {
    const name = otherName.trim();
    if (name === '' || name.length > MAX_OTHER) return null;
    return { sparePartId: null, otherName: name, note: cleanNote };
  }
  return { sparePartId: selected, otherName: null, note: cleanNote };
}

/**
 * The server answers a repeat of an open request with 200 and the EXISTING
 * request (D3) — no new row, so the same ids before and after.
 */
export function wasAlreadyRequested(before: PartRequest[], after: PartRequest[]): boolean {
  if (before.length !== after.length) return false;
  const ids = new Set(before.map((r) => r.id));
  return after.every((r) => ids.has(r.id));
}
