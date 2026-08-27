import { MessageSquareQuote, Star, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/utils/datetime";
import type { TicketDetail } from "@/types/ticket";

/**
 * What the customer said when they answered the confirmation link.
 *
 * Only the customer closes a job in this system, so this is the verdict on the
 * work — and it used to surface only as one line in the timeline, among
 * thirteen kinds of event. A manager opening an escalated ticket had to hunt
 * for the single fact they came for.
 *
 * Renders nothing until they have answered. An empty "Customer feedback" card
 * on a ticket still awaiting them says less than the status badge already does.
 */
export function CustomerVerdict({ ticket }: { ticket: TicketDetail }) {
  if (!ticket.customerConfirmedAt) return null;

  const refused = ticket.customerRefused;
  const words = ticket.customerFeedback?.trim();

  return (
    <Card className={refused ? "border-danger/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {refused ? (
            <TriangleAlert className="size-4 text-danger" aria-hidden />
          ) : (
            <MessageSquareQuote className="size-4 text-ink-3" aria-hidden />
          )}
          {refused ? "Customer says it is not finished" : "Customer feedback"}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* A refusal leads with the refusal. A score is beside the point when
            the answer was "you have not done it" — and the customer is not
            asked to rate work they say did not happen. */}
        {!refused ? (
          <div className="flex items-center gap-2">
            <Stars rating={ticket.customerRating} />
            <span className="text-xs text-ink-3">
              {ticket.customerRating === null
                ? "Confirmed, not rated"
                : `${ticket.customerRating} of 5`}
            </span>
          </div>
        ) : null}

        {words ? (
          <blockquote
            className={
              refused
                ? "mt-3 border-l-2 border-danger pl-3 text-[13px] leading-relaxed text-ink"
                : "mt-3 border-l-2 border-line-2 pl-3 text-[13px] leading-relaxed text-ink-2"
            }
          >
            {words}
          </blockquote>
        ) : refused ? (
          <p className="text-[13px] text-ink-2">They gave no reason.</p>
        ) : null}

        <p className="mt-3 text-xs text-ink-3">
          Answered {formatDateTime(ticket.customerConfirmedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Five stars, filled to the rating.
 *
 * A null rating draws none and the caption says why — "not rated" is a real
 * answer a customer can give, and showing zero filled stars beside the number 0
 * would report the worst possible score for somebody who simply did not rate.
 */
function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-lg text-ink-3">—</span>;
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={
            n <= rating ? "size-4 fill-warn text-warn" : "size-4 text-line-2"
          }
        />
      ))}
    </span>
  );
}
