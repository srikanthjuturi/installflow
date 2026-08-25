/**
 * "4m ago" from an instant.
 *
 * The server sends timestamps; the phrasing happens here, because it is only
 * true relative to the reader's clock and only at the moment it paints. A
 * string built server-side is already wrong by the time it crosses the wire.
 *
 * Deliberately coarse and deliberately not `Intl.RelativeTimeFormat`: this
 * appears in dense list rows where "4m" has to fit beside a title, and
 * `RelativeTimeFormat` renders "4 minutes ago" with no way to shorten it.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  // Clock skew, or a row that arrived over the socket a breath before the
  // server's own timestamp. "in 2s" would be nonsense; "just now" is honest.
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // Past a week the relative form stops helping — nobody counts in 23d.
  return then.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
