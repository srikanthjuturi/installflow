import { Link } from "react-router";
import { PartStatusBadge } from "@/components/parts/PartStatusBadge";
import { partRequestPath, trailLines } from "@/components/parts/partStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFeatureAccess } from "@/hooks/useAuth";
import type { NavOrigin } from "@/hooks/useNavOrigin";
import { relativeTime } from "@/lib/relativeTime";
import type { TicketDetail } from "@/types/ticket";

/**
 * The ticket's spare-part requests and their trail — Task 13 §5.8.
 *
 * Renders nothing when there are none. Like the Travel and Speed panels it is
 * NOT gated on `isOps` or a surface: the SERVER decides who receives the list
 * (`[]` for a vendor, a franchise principal's own franchisee's only), so a field
 * that arrives is a field to draw.
 *
 * **Open request** is a link into the facility's queue and appears only for a
 * handler (`has("parts.handle")`). The key is never granted to a staff role
 * (owner ruling 2026-10-15, R4): staff READ the trail, they do not work the
 * queue — and the request page itself answers a hand-typed visit with the
 * server's 403 sentence. `has` is presentation, never authorization.
 *
 * The photo itself is not drawn here: the signed link lives on the request page
 * (a non-handler can read the trail, not the picture), so a return that carries
 * one says *Photo on record*.
 */
export function PartRequestsPanel({
  ticket,
  origin,
}: {
  ticket: TicketDetail;
  /** Where Back should return to from the request page — this ticket (rule 11). */
  origin?: NavOrigin;
}) {
  const { has } = useFeatureAccess();
  const requests = ticket.partRequests;
  if (!requests || requests.length === 0) return null;

  const canOpen = has("parts.handle");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Spare parts</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-line-2">
          {requests.map((r) => (
            <li key={r.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold wrap-anywhere">
                  {r.partName}
                </span>
                <PartStatusBadge request={r} />
              </div>
              <p className="mt-1 text-xs text-ink-3">
                {r.code} · raised {relativeTime(r.createdAt)}
              </p>
              {r.note ? (
                <p className="mt-1.5 text-xs text-ink-2 wrap-anywhere">
                  &ldquo;{r.note}&rdquo;
                </p>
              ) : null}
              <ol className="mt-2 flex flex-col gap-1">
                {trailLines(r).map((line) => (
                  <li key={line.key} className="text-xs text-ink-2">
                    {line.text}
                  </li>
                ))}
              </ol>
              {r.returnPhotoUrl ? (
                <p className="mt-1.5 text-xs text-ink-3">Photo on record</p>
              ) : null}
              {canOpen ? (
                <Link
                  to={partRequestPath(r.id)}
                  state={origin}
                  className="mt-2 inline-block text-xs font-semibold text-brand-400"
                >
                  Open request
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
