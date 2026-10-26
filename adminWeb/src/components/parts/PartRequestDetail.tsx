import { useState } from "react";
import { Link } from "react-router";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NavOrigin } from "@/hooks/useNavOrigin";
import { cn } from "@/lib/utils";
import { TICKET_STATUSES, type TicketStatus } from "@/types/ticket";
import type { PartAction, PartRequest } from "@/types/parts";
import { EMPTY } from "@/utils/datetime";
import { formatPhone } from "@/utils/phone";
import { PartStatusBadge } from "./PartStatusBadge";
import { PART_ACTION, actionsFor, trailLines } from "./partStatus";

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y divide-line-2">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
        >
          <dt className="shrink-0 text-xs text-ink-3">{k}</dt>
          <dd className="min-w-0 text-right text-[13px] font-medium wrap-anywhere">
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The signed return photo. `onError` says so in words — the `ProofThumb` rule:
 * a link is signed for fifteen minutes, and a broken picture with no sentence
 * under it reads as a bug in the page.
 */
function ReturnPhoto({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid h-40 place-items-center rounded-md bg-surface-3 text-xs text-ink-3">
        Image unavailable
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="The old part, as received back"
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-80 w-full rounded-md bg-surface-3 object-contain"
    />
  );
}

/**
 * One part request, in full — Task 13 §5.7. Facts, the trail, the return photo
 * and one button per action the SERVER says is allowed (`actionsFor`), never a
 * second copy of the P4 state machine.
 *
 * `canHandle` is presentation only (hard rule 8): the portal passes
 * `has("parts.handle")`. The request page itself handles a 403 for a hand-typed
 * URL by showing the server's sentence.
 *
 * The ticket link carries the origin (hard rule 11): `origin` is "back to this
 * request", forwarded by the page so ticket → Back lands here.
 */
export function PartRequestDetail({
  request,
  canHandle,
  onAction,
  ticketOrigin,
}: {
  request: PartRequest;
  canHandle: boolean;
  onAction: (action: PartAction) => void;
  ticketOrigin?: NavOrigin;
}) {
  const actions = actionsFor(request, canHandle);
  const ticketStatus = (TICKET_STATUSES as readonly string[]).includes(
    request.ticketStatus
  )
    ? (request.ticketStatus as TicketStatus)
    : null;

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
      <div className="flex min-w-0 flex-col gap-3.5">
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-base font-semibold wrap-anywhere">
                    {request.partName}
                  </h2>
                  {request.isOther ? (
                    <span className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
                      Other
                    </span>
                  ) : null}
                  <PartStatusBadge request={request} />
                </div>
                <p className="mt-1.5 font-mono text-xs text-ink-3">
                  {request.code}
                </p>
              </div>

              {actions.length > 0 ? (
                <div className="flex flex-wrap gap-2.5">
                  {actions.map((a) => (
                    <Button
                      key={a}
                      type="button"
                      variant={
                        PART_ACTION[a].danger
                          ? "outline"
                          : a === actions[0]
                            ? "default"
                            : "outline"
                      }
                      className={cn(
                        PART_ACTION[a].danger &&
                          "hover:border-danger hover:text-danger"
                      )}
                      onClick={() => onAction(a)}
                    >
                      {PART_ACTION[a].label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>

            {request.note ? (
              <p className="mt-4 rounded-md bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2 wrap-anywhere">
                &ldquo;{request.note}&rdquo;
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-line-2 pb-4">
            <CardTitle className="text-sm">Trail</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2.5">
              {trailLines(request).map((line) => (
                <li key={line.key} className="text-[13px] text-ink-2">
                  {line.text}
                </li>
              ))}
            </ol>
            {request.issueNote ? (
              <p className="mt-3 text-xs text-ink-3">
                Issue note: {request.issueNote}
              </p>
            ) : null}
            {request.returnNote ? (
              <p className="mt-1.5 text-xs text-ink-3">
                Return note: {request.returnNote}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {request.returnPhotoUrl ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Photo on record</CardTitle>
            </CardHeader>
            <CardContent>
              <ReturnPhoto url={request.returnPhotoUrl} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3.5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">The job</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows
              rows={[
                ["Product", request.productLabel],
                ["Place", `${request.city} · ${request.pincode}`],
                [
                  "Ticket",
                  <span
                    key="t"
                    className="inline-flex flex-wrap items-center justify-end gap-2"
                  >
                    {/* The origin travels (rule 11), so ticket → Back lands on
                        this request and not on the ticket board. */}
                    <Link
                      to={`/franchise/tickets/${request.ticketId}`}
                      state={ticketOrigin}
                      className="font-mono text-xs font-semibold text-brand-400"
                    >
                      {request.ticketCode}
                    </Link>
                    {ticketStatus ? <StatusBadge status={ticketStatus} /> : null}
                  </span>,
                ],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Technician</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows
              rows={[
                ["Name", request.technicianName],
                [
                  "Phone",
                  request.technicianPhone ? (
                    <a
                      key="p"
                      href={`tel:${request.technicianPhone}`}
                      className="text-brand-400"
                    >
                      {formatPhone(request.technicianPhone)}
                    </a>
                  ) : (
                    EMPTY
                  ),
                ],
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
