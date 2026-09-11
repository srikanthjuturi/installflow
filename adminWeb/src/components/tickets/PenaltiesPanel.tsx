import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import type {
  PenaltyReviewer,
  TicketDetail,
  TicketPenalty,
} from "@/types/ticket";

/** The API's role keys, as a person reads them. Only the four that review. */
const REVIEWER_ROLE: Record<PenaltyReviewer["role"], string> = {
  area_manager: "Area Manager",
  regional_head: "Regional Head",
  national_head: "National Head",
  admin: "Admin",
};

/**
 * What technicians were charged on this ticket, and the way to give it back.
 *
 * The ticket page is the one place an Area Manager can do this: the Penalty &
 * Bonus list is Admin and National Head only, by design — an AM may see the
 * pool's balance but not who it was collected from. The ticket they CAN open,
 * for anything in their own states, and the penalty is about this ticket.
 *
 * Ops-only and shown only when there is something to show. NOT hidden on a
 * settled ticket, unlike the header's actions: somebody else may have closed
 * the job since, and that has no bearing on whether a charge was fair.
 *
 * The reviewer line names who is responsible — the ticket's Area Manager, else
 * its Regional Head, else a National Head, else an Admin. It does not limit
 * who may act: anyone at that rank or above who can see this ticket may, and
 * the server is what enforces it. `canReverse` only decides whether to draw
 * the button for THIS viewer.
 *
 * ⚠ Net-new copy — neither prototype has a reversal anywhere. Every string here
 * needs sign-off, the same position `NoShowDialog` is in.
 */
export function PenaltiesPanel({
  ticket,
  canReverse,
  onReverse,
}: {
  ticket: TicketDetail;
  canReverse: boolean;
  onReverse: (penalty: TicketPenalty) => void;
}) {
  if (ticket.penalties.length === 0) return null;
  const reviewer = ticket.penaltyReviewer;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Penalties</CardTitle>
        {reviewer ? (
          <CardDescription className="text-xs">
            Reversible by {reviewer.name} ({REVIEWER_ROLE[reviewer.role]}) or
            anyone senior.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-line-2">
          {ticket.penalties.map((p) => {
            const reversed = p.reversedAt !== null;
            return (
              <li key={p.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {p.technicianName}
                    </div>
                    <div className="text-xs text-ink-3">
                      {p.reason} · {formatDateTime(p.chargedAt)}
                    </div>
                  </div>
                  {/* The technician's reading, as the ledger prints it: a
                      penalty is a debit. Struck through once given back, and
                      said in words too — colour alone fails WCAG 1.4.1. */}
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tabular-nums",
                      reversed ? "text-ink-3 line-through" : "text-danger"
                    )}
                  >
                    −{moneyPaise(p.amountPaise)}
                  </span>
                </div>

                {reversed ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-2">
                    <Undo2 className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      Reversed by {p.reversedByName ?? "—"} ·{" "}
                      {formatDateTime(p.reversedAt)}
                      {p.reversalReason ? ` · ${p.reversalReason}` : ""}
                    </span>
                  </p>
                ) : canReverse ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => onReverse(p)}
                  >
                    <Undo2 data-icon="inline-start" aria-hidden />
                    Reverse
                    <span className="sr-only">
                      {" "}
                      the {moneyPaise(p.amountPaise)} penalty to{" "}
                      {p.technicianName}
                    </span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
