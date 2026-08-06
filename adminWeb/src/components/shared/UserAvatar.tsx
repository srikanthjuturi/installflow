import { cn } from "@/lib/utils";

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
}

interface UserAvatarProps {
  name: string;
  /** Data URL of the chosen picture, or `null`/empty for the initials fallback. */
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
 */
export function UserAvatar({ name, src, className }: UserAvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        decoding="async"
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
