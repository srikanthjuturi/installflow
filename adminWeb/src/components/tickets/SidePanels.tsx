import { Barcode, Camera, Hash, MapPin } from "lucide-react";
import { LinkButton } from "@/components/shared/LinkButton";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TicketDetail } from "@/services/tickets";

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
            {initials(ticket.customer)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {ticket.customer}
            </div>
            <a
              href={`tel:${ticket.mobile.replace(/\s/g, "")}`}
              className="text-xs text-ink-2 hover:text-brand-400"
            >
              {ticket.mobile}
            </a>
          </div>
        </div>
        <p className="mt-3.5 text-xs leading-relaxed text-ink-2">
          {ticket.city} · {ticket.pincode}
          <br />
          Confirmed slot:{" "}
          <b className="font-semibold text-ink">{ticket.slot}</b>
        </p>
      </CardContent>
    </Card>
  );
}

export function TechnicianPanel({ ticket }: { ticket: TicketDetail }) {
  const assigned = ticket.tech !== "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Assigned technician</CardTitle>
      </CardHeader>
      <CardContent>
        {assigned ? (
          <div className="flex items-center gap-3">
            <UserAvatar name={ticket.tech} className="size-11 text-base" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {ticket.tech}
              </div>
              {/* Assignment is first-accept-wins — never allocated by a manager. */}
              <div className="truncate text-xs text-ink-3">
                First-accept · {ticket.category}
              </div>
            </div>
            <span className="rounded-full bg-ok-bg px-2.25 py-0.75 text-xs font-semibold text-ok">
              On job
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] text-ink-2">No technician assigned yet</p>
            <LinkButton
              variant="outline"
              size="sm"
              to={`/escalations/${ticket.id}/assign`}
            >
              Assign manually
            </LinkButton>
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
