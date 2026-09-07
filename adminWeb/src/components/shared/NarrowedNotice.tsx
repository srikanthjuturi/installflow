/**
 * "You are not looking at everything, and here is the way back."
 *
 * A screen reached from the dashboard arrives carrying that dashboard's
 * filters, and the destination usually has no control for them: the escalation
 * queue has no territory picker, and the ticket board has no control for an SLA
 * bucket or for "not yet closed". Without this line a manager sees four rows,
 * has no idea two hundred are being withheld, and reasonably concludes the
 * screen is broken.
 *
 * Only ever names what the reader CANNOT see. A filter with a visible control —
 * the queue's `half` pill, the board's status chips — reflects the URL already,
 * and naming it here would be the screen explaining a thing it is showing.
 *
 * Renders nothing when nothing is narrowed, so a caller can hand it whatever it
 * has without branching.
 */
export interface NarrowedNoticeProps {
  /**
   * What is on, in the reader's own words, joined with " · ". Lower case: they
   * run on from the lead sentence rather than standing as headings.
   */
  parts: string[];
  /** The escape hatch's words — "Show the whole queue", "Show the whole board". */
  actionLabel: string;
  /** Drop everything `parts` named. The caller owns the URL, so it owns this. */
  onClear: () => void;
}

export function NarrowedNotice({
  parts,
  actionLabel,
  onClear,
}: NarrowedNoticeProps) {
  if (parts.length === 0) return null;

  return (
    <p className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-surface-2 px-3.5 py-2.5 text-xs text-ink-2">
      <span>Narrowed from the dashboard · {parts.join(" · ")}</span>
      <button
        type="button"
        className="font-semibold text-brand-400 hover:text-brand-500"
        onClick={onClear}
      >
        {actionLabel}
      </button>
    </p>
  );
}
