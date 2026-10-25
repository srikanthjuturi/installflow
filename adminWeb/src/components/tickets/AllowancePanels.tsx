import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EMPTY, formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import type { TicketDetail } from "@/types/ticket";
import {
  clockOrigin,
  speedOutcome,
  speedRule,
  speedTimeTaken,
  TRAVEL_REASON,
  travelDistance,
  travelFrom,
  travelRule,
  travelStatus,
  travelTo,
} from "./allowanceWording";

/**
 * Task 13 §5.8 — what a job pays for the technician's distance and speed.
 *
 * ⚠ Neither panel is gated on `isOps` or on a surface. The SERVER decides who
 * receives the block (company staff, Area Manager and above, on every ticket in
 * scope — non-home included, owner ruling 2026-10-15 R8 — and the ticket's own
 * franchisee admin; never a vendor or facility staff), so a field that arrives
 * is a field to draw and a null one draws nothing. Gating here as well would be
 * a second copy of the rule, which is the copy that drifts.
 *
 * Money goes through `moneyPaise`, never inline (hard rule 7). All wording is
 * `allowanceWording.ts`'s — §5.10 PROPOSED copy, awaiting sign-off.
 */

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y divide-line-2">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
        >
          <dt className="shrink-0 text-xs text-ink-3">{k}</dt>
          <dd className="min-w-0 text-right text-[13px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The travel allowance frozen when the job was accepted (TA5). */
export function TravelPanel({ ticket }: { ticket: TicketDetail }) {
  const travel = ticket.travel;
  if (!travel) return null;

  const from = travelFrom(travel);
  const to = travelTo(travel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Travel allowance</CardTitle>
        <p className="text-xs text-ink-3">
          Frozen when {ticket.technicianName ?? "the technician"} accepted ·{" "}
          {formatDateTime(travel.acceptedAt)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* A reason is the answer, not an error: nothing to measure, so the
            allowance is ₹0 and the job was accepted all the same (TA8). */}
        {travel.reason ? (
          <p className="rounded-md bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
            {TRAVEL_REASON[travel.reason] ?? travel.reason}
          </p>
        ) : null}
        <Rows
          rows={[
            [
              "Distance",
              travel.reason === "no_base_location" ||
              travel.reason === "no_customer_point"
                ? "0 km"
                : travelDistance(travel),
            ],
            ["From", from ?? EMPTY],
            ["To", to ?? EMPTY],
            ["Rule", travelRule(travel)],
            [
              "Allowance",
              <span
                key="a"
                className={cn(
                  "font-semibold",
                  travel.creditedPaise !== null ? "text-ok" : undefined
                )}
              >
                {travelStatus(travel, ticket.status)}
              </span>,
            ],
          ]}
        />
        {/* The amount worked out at accept, when it differs from what the
            status line names — an open job shows what it WILL pay. */}
        {travel.creditedPaise === null && travel.amountPaise > 0 ? (
          <p className="text-xs text-ink-3">
            Worked out as {moneyPaise(travel.amountPaise)}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The speed allowance — frozen terms, measured clock, outcome. */
export function SpeedPanel({ ticket }: { ticket: TicketDetail }) {
  const speed = ticket.speed;
  if (!speed) return null;

  const outcome = speedOutcome(speed);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Speed allowance</CardTitle>
      </CardHeader>
      <CardContent>
        <Rows
          rows={[
            ["Rule", speedRule(speed)],
            [
              "Reward",
              speed.rewardPaise > 0
                ? `Within ${speed.rewardWithinHours} h · ${moneyPaise(speed.rewardPaise)}`
                : EMPTY,
            ],
            [
              "Penalty",
              speed.penaltyPaise > 0
                ? `After ${speed.penaltyAfterHours} h · ${moneyPaise(-speed.penaltyPaise)}`
                : EMPTY,
            ],
            ["Time taken", speedTimeTaken(speed)],
            [
              "Outcome",
              <span key="o" className="inline-flex flex-wrap justify-end gap-x-1.5">
                <span
                  className={cn(
                    "font-semibold",
                    speed.outcome === "reward" ? "text-ok" : undefined,
                    speed.outcome === "penalty" ? "text-danger" : undefined
                  )}
                >
                  {outcome.text}
                </span>
                {outcome.notes.map((n) => (
                  <span key={n} className="text-xs font-normal text-ink-3">
                    {n}
                  </span>
                ))}
              </span>,
            ],
          ]}
        />
        {/* While the clock runs the origin is already inside "Time taken";
            once measured, say which half of the later-of-two it took. */}
        {speed.workingHours !== null && speed.clockStartedAt ? (
          <p className="mt-3 text-xs text-ink-3">
            Clock started {formatDateTime(speed.clockStartedAt)}{" "}
            {clockOrigin(speed)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
