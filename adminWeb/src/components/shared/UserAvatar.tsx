import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * "Ravi Sharma" → RS · "Ravi" → RA · "ravi.sharma@x.com" → RS · "aiteam@…" → AI.
 *
 * Two letters wherever two can be found, because one letter on a disc reads as
 * a bullet rather than a person.
 *
 * The two inputs split by DIFFERENT rules, and that is the point. An email
 * standing in for a name has no spaces to work with — "ravi.sharma@x.com" is
 * two words wearing punctuation — so there its separators count. The DOMAIN is
 * dropped first: it names the employer, so keeping it would give two
 * colleagues the same second letter. A real name splits on whitespace ONLY,
 * which keeps a hyphen inside the word it belongs to: "Jean-Pierre Dupont" is
 * JD, a person's initials, not JP, the first name counted twice.
 */
function initialsOf(name: string) {
  const trimmed = name.trim();
  const isEmail = trimmed.includes("@");
  const parts = (isEmail ? trimmed.split("@")[0]! : trimmed)
    .split(isEmail ? /[\s._-]+/ : /\s+/)
    .filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  return letters.toUpperCase();
}

interface UserAvatarProps {
  name: string;
  /** Stored URL of the person's picture, or `null`/empty for the initials
   *  fallback. A URL that fails to load falls back too. */
  src?: string | null;
  /** Extra classes — set the size here (e.g. `size-14`, `text-lg`). */
  className?: string;
}

/**
 * The one place a person's face is drawn: their uploaded picture if there is
 * one, their initials on the brand tint otherwise. Every technician, console
 * user and the signed-in account renders through this — so a re-skin, or the
 * picture appearing, lands everywhere at once and the discs can never drift.
 * Set the size from the caller with `className` (box + text, e.g. `size-14
 * text-lg`). Decorative: callers always show the name beside it, so it stays
 * `aria-hidden`.
 *
 * A photo that 404s (a blob deleted behind the record, an expired host) falls
 * back to the initials rather than leaving the browser's broken-image glyph in
 * a row of clean discs — the failure is remembered against the URL that caused
 * it, so a later `src` gets its own chance rather than inheriting the verdict.
 */
export function UserAvatar({ name, src, className }: UserAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);

  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        onError={() => setFailed(src)}
        className={cn(
          "shrink-0 rounded-full object-cover",
          "size-9",
          className
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        "size-9 bg-status-assigned-bg text-brand-400",
        className
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
