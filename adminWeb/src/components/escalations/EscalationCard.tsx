import { Link } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { Card, CardContent } from "@/components/ui/card";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { formatSlot, slotCountdown } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import type { Ticket } from "@/types/ticket";

/**
 * Why this ticket is sitting here, in one line.
 *
 * Derived rather than stored, and the API sends no `reason` field on purpose:
 * there is exactly one way into this queue — the slot came within four hours
 * and nobody had accepted — so a stored reason would be a constant with a
 * column behind it. What genuinely varies is whether money has already been
 * spent trying, and that is the sentence a manager needs, because it is the
 * difference between "try a bonus" and "a bonus did not work".
 */
function reasonFor(ticket: Ticket): string {
  return ticket.bonusPaise === null
    ? "No technician accepted"
    : `Re-notified with a ${moneyPaise(ticket.bonusPaise)} bonus · still unassigned`;
}

/**
 * One escalated ticket. The left border is danger-toned because every row
 * here is a customer holding a confirmed slot that nobody is going to.
 *
 * `missed` is the same card for a slot that has already closed. It keeps both
 * actions — a manager may still want to send somebody late, and a bonus is
 * still what would persuade them — but drops the alarm colouring, because a
 * red border that means "act now" on twenty rows nobody can act on is what
 * teaches people to stop reading the colour.
 */
export function EscalationCard({
  ticket,
  missed = false,
  readAt,
}: {
  ticket: Ticket;
  missed?: boolean;
  /**
   * When the rows were READ, as an epoch. The countdown is measured against it
   * rather than `new Date()` so this card and the queue's own live/missed split
   * are reading the same instant — otherwise a card could sit in the live half
   * saying its slot had closed.
   */
  readAt: number;
}) {
  /* All three links leave this queue, and all three used to land somewhere that
     assumed you had come from the ticket board — so Back dropped a manager onto
     `/tickets`, or worse, onto the very ticket they were still deciding about.
     The queue is a working list you come back to; say so on the way out. */
  const origin = useNavOrigin("Back to escalations");
  const countdown = slotCountdown(
    ticket.slotStart,
    ticket.slotEnd,
    new Date(readAt)
  );

  return (
    <Card className={missed ? undefined : "border-l-3 border-l-danger"}>
      <CardContent className="flex flex-wrap items-center gap-4.5">
        <div className="min-w-50 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to={`/tickets/${ticket.id}`}
              state={origin}
              className="font-mono text-sm font-semibold hover:text-brand-400"
            >
              {ticket.code}
            </Link>
            <span className="text-xs text-ink-2">
              {ticket.customerName} · {ticket.modelName}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            {ticket.city} · {ticket.pincode} ·{" "}
            {/* The slot, not the SLA due time: it is the promise being missed. */}
            Slot {formatSlot(ticket.slotStart, ticket.slotEnd)}
          </p>
          <p className="mt-1.5 text-xs font-medium text-danger">
            {reasonFor(ticket)}
          </p>
        </div>

        {/* The two figures, held together and set off from the description by
            a hairline: the card reads WHAT · WHEN AND HOW MUCH · DO.

            Fixed widths, and that is the point of them. They were `px-3.5`
            around content, so each column started wherever the previous card's
            digits happened to end — "58m" and "1h 10m" pushed their headings to
            different x positions, and a list of cards that should scan as a
            table came out ragged. */}
        <div className="flex shrink-0 items-center gap-2 border-l border-line-2 pl-4.5">
          <div className="w-30 text-center">
            {/* The label carries the tense, so the figure below can stay a bare
                span in all three states — see `slotCountdown`. */}
            <div className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              {countdown.label}
            </div>
            {/* Muted once the window has closed. An alarm-red figure on a row
                nobody can rescue is shouting about something already over. */}
            <div
              className={
                countdown.state === "closed"
                  ? "font-mono text-xl font-semibold text-ink-3"
                  : "font-mono text-xl font-semibold text-danger"
              }
            >
              {countdown.value}
            </div>
          </div>

          <div className="w-24 text-center">
            {/* Was "Bonus pool" against a figure the mock invented. Nothing
                collects penalties yet, so there is no pool to report — this is
                what has actually been spent on this job, which is real. */}
            <div className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              Bonus
            </div>
            <div
              className={
                ticket.bonusPaise === null
                  ? "text-lg font-semibold text-ink-3"
                  : "text-lg font-semibold text-ok"
              }
            >
              {moneyPaise(ticket.bonusPaise)}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton to={`/tickets/${ticket.id}/bonus`} state={origin}>
            Add bonus &amp; re-notify
          </LinkButton>
          <LinkButton
            variant="outline"
            to={`/tickets/${ticket.id}/assign`}
            state={origin}
          >
            Assign manually
          </LinkButton>
        </div>
      </CardContent>
    </Card>
  );
}
