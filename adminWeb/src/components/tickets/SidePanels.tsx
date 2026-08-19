import { useState } from "react";
import { Barcode, Camera, Hash, MapPin } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/utils/clipboard";
import { EMPTY, formatSlot } from "@/utils/datetime";
import type { TicketDetail } from "@/types/ticket";

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

/** Ops sees customer contact throughout — the masking rule is the
 *  technician app's, and only applies before they accept. */
export function CustomerPanel({ ticket }: { ticket: TicketDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Customer</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-100 text-base font-semibold text-brand-500">
            {initials(ticket.customerName)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {ticket.customerName}
            </div>
            <a
              href={`tel:${ticket.customerPhone.replace(/\s/g, "")}`}
              className="text-xs text-ink-2 hover:text-brand-400"
            >
              {ticket.customerPhone}
            </a>
          </div>
        </div>
        <p className="mt-3.5 text-xs leading-relaxed text-ink-2">
          {ticket.address}
          <br />
          {ticket.city}, {ticket.state} · {ticket.pincode}
          <br />
          Confirmed slot:{" "}
          <b className="font-semibold text-ink">
            {formatSlot(ticket.slotStart, ticket.slotEnd)}
          </b>
          {/* Who chose it. Ops agreeing a time on a call and the customer
              picking one are different facts, and the second is the one that
              means somebody actually said yes. */}
          {ticket.slotConfirmedAt ? (
            <>
              <br />
              <span className="text-ok">Picked by the customer</span>
            </>
          ) : null}
        </p>

        <SlotRequest ticket={ticket} />
      </CardContent>
    </Card>
  );
}

/**
 * The state of the "pick a time" message, and a way to act when it failed.
 *
 * Silent on the two states nobody needs to act on — ops set the slot
 * themselves, or the customer has already picked. It appears exactly when
 * somebody might have to do something about it.
 */
function SlotRequest({ ticket }: { ticket: TicketDetail }) {
  const [copied, setCopied] = useState(false);
  if (ticket.slotConfirmedAt || ticket.slotRequestStatus === "not_needed") {
    return null;
  }

  const failed = ticket.slotRequestStatus === "failed";

  return (
    <div
      className={cn(
        "mt-3.5 rounded-md px-3 py-2.5 text-xs leading-relaxed",
        failed ? "bg-danger-bg text-danger" : "bg-info-bg text-info"
      )}
    >
      <p className="font-semibold">
        {failed
          ? "Couldn't send the slot request"
          : "Waiting for the customer to pick a time"}
      </p>
      {/* WhatsApp's own words. A generic "delivery failed" would leave ops
          guessing between a wrong number and an unapproved template. */}
      {failed && ticket.slotRequestError ? (
        <p className="mt-1 opacity-90">{ticket.slotRequestError}</p>
      ) : null}

      {ticket.slotLink ? (
        <>
          <p className="mt-1.5 opacity-90">
            {failed
              ? "Send this link another way, or read the times out over the phone."
              : "They can also be given this link directly."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface/60 px-2 py-1 font-mono text-[11px]">
              {ticket.slotLink}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-xs"
              onClick={() => {
                const link = ticket.slotLink;
                if (!link) return;
                // Never throws — a denied clipboard degrades to "select it
                // yourself", and the link is on screen either way.
                void copyToClipboard(link).then(setCopied);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TechnicianPanel({
  ticket,
  action,
}: {
  ticket: TicketDetail;
  /**
   * What to offer when nobody is assigned. A slot, not a boolean, for the same
   * reason `TicketDetailPage.actions` is one: the portal passes `null` and
   * never has to know that an ops assign route exists.
   */
  action?: React.ReactNode;
}) {
  // A real null now, not the "—" sentinel the mock used to mean "nobody".
  const assigned = ticket.technicianName !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Assigned technician</CardTitle>
      </CardHeader>
      <CardContent>
        {assigned ? (
          <div className="flex items-center gap-3">
            <UserAvatar name={ticket.technicianName ?? EMPTY} className="size-11 text-base" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {ticket.technicianName ?? EMPTY}
              </div>
              {/* Assignment is first-accept-wins — never allocated by a manager. */}
              <div className="truncate text-xs text-ink-3">
                First-accept · {ticket.subcategoryName}
              </div>
            </div>
            <span className="rounded-full bg-ok-bg px-2.25 py-0.75 text-xs font-semibold text-ok">
              On job
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] text-ink-2">No technician assigned yet</p>
            {action}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The four artifacts §8 requires. Gallery uploads are never accepted. */
const PROOFS = [
  { label: "Barcode", icon: Barcode },
  { label: "Serial No.", icon: Hash },
  { label: "Product photo", icon: Camera },
  { label: "Geo live photo", icon: MapPin },
];

export function ProofPanel({ hasProof }: { hasProof: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Proof of completion</CardTitle>
      </CardHeader>
      <CardContent>
        {hasProof ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {PROOFS.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.label}
                    className="flex aspect-4/3 flex-col items-center justify-center gap-1.5 rounded-md bg-surface-3 text-ink-2"
                  >
                    <Icon className="size-5" aria-hidden />
                    <span className="text-[11px] font-medium">{p.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-2">
              <span className="size-1.75 rounded-full bg-ok" aria-hidden />
              Geo-tag matched ticket pincode
            </p>
          </>
        ) : (
          <p className="text-[13px] text-ink-2">
            Not submitted yet. Proof is captured on site at job completion.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
