import { useState } from "react";
import { Barcode, Camera, Hash, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTicketProof } from "@/hooks/useTickets";
import { describeError } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/utils/clipboard";
import { EMPTY, formatDateTime, formatSlot } from "@/utils/datetime";
import type { TicketDetail, TicketProof } from "@/types/ticket";

/**
 * Proof exists exactly when the job started — the rows are written in the same
 * transaction as the `started` event, so that event is the fact to read.
 *
 * Not a set of statuses. `Escalated` is reachable two ways — a customer said
 * the work was not done, or nobody ever accepted it — and only the first has
 * anything to show. Asking the trail tells the two apart; asking the status
 * cannot.
 */
function hasStarted(ticket: TicketDetail): boolean {
  return ticket.timeline.some((e) => e.kind === "started");
}

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
  // How they came to hold it. This said "First-accept" unconditionally, on the
  // reasoning that assignment is first-accept-wins and never allocated by a
  // manager — which stopped being true when the escalation queue landed: a job
  // nobody accepted is handed over by hand, and the panel was calling that a
  // choice the technician made.
  //
  // Read off the trail already on this page rather than asking the API for a
  // field of its own: the `assigned` event records who caused it, so there is
  // no extra request and no second answer that could disagree with the
  // timeline three inches away. `actorKind`, not the title — a title is
  // presentation and free to be reworded.
  const how = ticket.timeline.some(
    (e) => e.kind === "assigned" && e.actorKind === "staff"
  )
    ? "Assigned by a manager"
    : "First-accept";

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
              <div className="truncate text-xs text-ink-3">
                {how} · {ticket.subcategoryName}
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
const PROOF_KIND: Record<TicketProof["kind"], { label: string; icon: LucideIcon }> = {
  barcode: { label: "Barcode", icon: Barcode },
  serial: { label: "Serial No.", icon: Hash },
  photos: { label: "Product photo", icon: Camera },
  live: { label: "Geo live photo", icon: MapPin },
};

/**
 * What the technician actually photographed.
 *
 * This exists because of escalation: when a customer says the job was not
 * finished, the manager picking it up needs to see what was captured, and
 * until this panel bound to the API nothing outside the technician's phone
 * could. The vendor sees it too — it is their customer.
 *
 * The URLs are signed and expire in minutes, which is why `useTicketProof`
 * does not cache them and why a thumbnail that fails to load says so rather
 * than showing a broken frame.
 */
export function ProofPanel({ ticket }: { ticket: TicketDetail }) {
  const [open, setOpen] = useState<TicketProof | null>(null);

  // Nothing is captured before the technician starts, so there is nothing to
  // ask the server for.
  const expectProof = hasStarted(ticket);
  const { data, isLoading, isError, error, refetch } = useTicketProof(
    ticket.id,
    expectProof
  );

  const live = data?.find((p) => p.kind === "live" && p.latitude !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Proof of completion</CardTitle>
      </CardHeader>
      <CardContent>
        {!expectProof ? (
          <p className="text-[13px] text-ink-2">
            Not submitted yet. Proof is captured on site at job completion.
          </p>
        ) : isError ? (
          <div className="text-[13px] text-ink-2">
            <p className="text-danger" role="alert">
              {describeError(error, "Couldn't load the proof").description ??
                "Couldn't load the proof"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-4/3 rounded-md" />
            ))}
          </div>
        ) : !data?.length ? (
          // The status says proof should exist and none came back. Said
          // plainly rather than shown as an empty grid, because on this panel
          // "nothing here" is itself the finding.
          <p className="text-[13px] text-ink-2">
            This job was started but has no proof images on record.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {data.map((proof) => (
                <ProofThumb
                  key={`${proof.kind}-${proof.ordinal}`}
                  proof={proof}
                  onOpen={() => setOpen(proof)}
                />
              ))}
            </div>
            <GeoLine live={live} ticketPincode={ticket.pincode} />
          </>
        )}
      </CardContent>

      <ProofLightbox proof={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

function ProofThumb({
  proof,
  onOpen,
}: {
  proof: TicketProof;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const meta = PROOF_KIND[proof.kind];
  const Icon = meta.icon;
  const label =
    proof.kind === "photos" ? `${meta.label} ${proof.ordinal}` : meta.label;

  // No URL means blob storage is unconfigured, or the row's name does not
  // belong to this company. The record stands either way; the picture simply
  // is not served, and pretending otherwise would be the worse answer.
  if (!proof.url || failed) {
    return (
      <div className="flex aspect-4/3 flex-col items-center justify-center gap-1.5 rounded-md bg-surface-3 text-center text-ink-3">
        <Icon className="size-5" aria-hidden />
        <span className="px-1 text-[11px] font-medium">{label}</span>
        <span className="px-1 text-[10px]">Image unavailable</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-4/3 overflow-hidden rounded-md bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
    >
      <img
        src={proof.url}
        alt={label}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover transition-transform group-hover:scale-105"
      />
      {/* Over the photograph, so it needs its own ground rather than a token
          colour that assumes what is underneath. */}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 text-[10px] font-medium text-white">
        {label}
      </span>
    </button>
  );
}

/**
 * Where the phone was, against where the job was.
 *
 * The old copy asserted "Geo-tag matched ticket pincode" unconditionally, on a
 * panel that had no coordinates at all. This says which of the three things is
 * actually true — matched, did not match, or was never captured — because a
 * disputed attendance is exactly when somebody reads this line.
 */
function GeoLine({
  live,
  ticketPincode,
}: {
  live: TicketProof | undefined;
  ticketPincode: string;
}) {
  if (!live) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-2">
        <span className="size-1.75 rounded-full bg-ink-3" aria-hidden />
        No location on the live photo
      </p>
    );
  }

  const matched = live.devicePincode === ticketPincode;
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-2">
      <span
        className={cn(
          "mt-1.25 size-1.75 shrink-0 rounded-full",
          matched ? "bg-ok" : "bg-warn"
        )}
        aria-hidden
      />
      <span>
        {matched
          ? `Geo-tag matched ticket pincode ${ticketPincode}`
          : `Geo-tag reads ${live.devicePincode ?? "an unnamed area"} · ticket says ${ticketPincode}`}
        {live.accuracyM !== null ? (
          <span className="text-ink-3"> · ±{Math.round(live.accuracyM)}m</span>
        ) : null}
      </span>
    </p>
  );
}

/** Full size, because a 2-column sidebar thumbnail is not evidence. */
function ProofLightbox({
  proof,
  onClose,
}: {
  proof: TicketProof | null;
  onClose: () => void;
}) {
  const meta = proof ? PROOF_KIND[proof.kind] : null;
  const label = !proof
    ? ""
    : proof.kind === "photos"
      ? `${meta?.label} ${proof.ordinal}`
      : (meta?.label ?? "");

  return (
    <Dialog open={proof !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{label}</DialogTitle>
          <DialogDescription className="text-xs">
            Captured {proof ? formatDateTime(proof.capturedAt) : EMPTY}
          </DialogDescription>
        </DialogHeader>
        {proof?.url ? (
          <img
            src={proof.url}
            alt={label}
            className="max-h-[70vh] w-full rounded-md object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
