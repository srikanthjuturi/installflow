import { Link } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { Card, CardContent } from "@/components/ui/card";
import { formatSlot, timeUntil } from "@/utils/datetime";
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
}: {
  ticket: Ticket;
  missed?: boolean;
}) {
  return (
    <Card className={missed ? undefined : "border-l-3 border-l-danger"}>
      <CardContent className="flex flex-wrap items-center gap-4.5">
        <div className="min-w-50 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to={`/tickets/${ticket.id}`}
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

        <div className="px-3.5 text-center">
          <div className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
            Time to slot
          </div>
          {/* Muted once the window has closed. "Slot passed" in alarm red on
              a row nobody can rescue is shouting about something already
              over. */}
          <div
            className={
              missed
                ? "font-mono text-xl font-semibold text-ink-3"
                : "font-mono text-xl font-semibold text-danger"
            }
          >
            {timeUntil(ticket.slotStart)}
          </div>
        </div>

        <div className="px-3.5 text-center">
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

        <div className="flex flex-wrap gap-2">
          <LinkButton to={`/tickets/${ticket.id}/bonus`}>
            Add bonus &amp; re-notify
          </LinkButton>
          <LinkButton variant="outline" to={`/tickets/${ticket.id}/assign`}>
            Assign manually
          </LinkButton>
        </div>
      </CardContent>
    </Card>
  );
}
