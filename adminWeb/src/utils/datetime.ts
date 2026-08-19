/**
 * Formatting for the instants the API returns.
 *
 * The mock stored pre-formatted display strings — `"Aug 4, 08:12"`, `"Aug 5,
 * 10:00–12:00"` — so nothing in the console ever parsed a date. Real responses
 * carry ISO instants, which have to be rendered somewhere, and rendering them
 * in one place is what stops six screens disagreeing about how a slot reads.
 *
 * `en-IN` throughout, and the dash between slot times is an en dash (–), which
 * is what the approved prototype uses.
 */

/** Nothing recorded. The em dash the tables already draw for an absent value. */
export const EMPTY = "—";

/** `5 Aug` — a date with no year, for things inside the current cycle. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/** `4 Aug, 08:12` — a date and a time, for created/updated stamps. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  })}, ${d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

const time = (d: Date) =>
  d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/**
 * `5 Aug, 10:00–12:00`, or the em dash when no slot is agreed yet.
 *
 * A slot that somehow spans midnight prints both dates rather than pretending
 * it does not — rare, but silently wrong is worse than briefly ugly.
 */
export function formatSlot(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start || !end) return EMPTY;
  const from = new Date(start);
  const to = new Date(end);
  const sameDay = from.toDateString() === to.toDateString();
  return sameDay
    ? `${formatDate(start)}, ${time(from)}–${time(to)}`
    : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/**
 * `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time, not the `Z`-suffixed
 * instant an API returns. Used to seed a slot field when editing.
 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
