import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * Zod for the spare-parts forms — Task 13 §5.7 / §5.6. Bounds are the server's
 * (`features/spare_parts/schemas.py`) or tighter where §5.10 says so.
 */

/**
 * Rejecting — and cancelling an approved request, which is the same call
 * (owner ruling 2026-10-15, R2). The server allows 1–255; the form asks for 3
 * (`RescheduleDialog`'s required-reason shape) because the technician reads it
 * and the territory bell quotes it, and "x" is not a reason.
 */
export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Tell the technician why — at least 3 characters")
    .max(255, "Keep it under 255 characters"),
});
export type RejectValues = z.infer<typeof rejectSchema>;
export const rejectResolver = zodResolver(rejectSchema);

/** An optional note on Mark issued / Log return — the server's ≤ 500. */
export const noteSchema = z.object({
  note: z.string().trim().max(500, "Keep it under 500 characters"),
});
export type NoteValues = z.infer<typeof noteSchema>;
export const noteResolver = zodResolver(noteSchema);

/** `""` means "no note" on the wire, as `null`. */
export function noteOrNull(note: string): string | null {
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed;
}

/** The catalogue name's bounds, §5.10: 1–80 characters, trimmed. */
export const PART_NAME_MAX = 80;

/**
 * Validates a name typed into the parts editor against the names already on
 * that owner. Case-insensitive, whitespace-collapsing — the server compares
 * `lower(btrim(name))` and a duplicate is a 409 with no code, so it is caught
 * here where it can be said on the field.
 *
 * `existing` is the owner's OWN rows (active and inactive alike): a hidden row
 * still owns its name, and adding it again would 409. `editingId` skips the row
 * being renamed.
 *
 * Returns the error sentence, or `null` when the name is fine.
 */
export function validatePartName(
  raw: string,
  existing: { id: string; name: string }[],
  editingId?: string
): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "") return "Enter a part name";
  if (name.length > PART_NAME_MAX) return "Up to 80 characters";
  const key = name.toLowerCase();
  const clash = existing.some(
    (p) =>
      p.id !== editingId &&
      p.name.trim().replace(/\s+/g, " ").toLowerCase() === key
  );
  return clash ? "That part is already on this list" : null;
}
