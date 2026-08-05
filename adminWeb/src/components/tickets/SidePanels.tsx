import { Link } from "react-router";
import { Barcode, Camera, Hash, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
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
          <div className="bg-brand-100 text-brand-500 grid size-11 shrink-0 place-items-center rounded-full text-base font-semibold">
            {initials(ticket.customer)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{ticket.customer}</div>
            <a
              href={`tel:${ticket.mobile.replace(/\s/g, "")}`}
              className="text-ink-2 hover:text-brand-400 text-xs"
            >
              {ticket.mobile}
            </a>
          </div>
        </div>
        <p className="text-ink-2 mt-3.5 text-xs leading-relaxed">
          {ticket.city} · {ticket.pincode}
          <br />
          Confirmed slot: <b className="text-ink font-semibold">{ticket.slot}</b>
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
            <div className="bg-brand-100 text-brand-500 grid size-11 shrink-0 place-items-center rounded-full text-base font-semibold">
              {initials(ticket.tech)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{ticket.tech}</div>
              {/* Assignment is first-accept-wins — never allocated by a manager. */}
              <div className="text-ink-3 truncate text-xs">
                First-accept · {ticket.category}
              </div>
            </div>
            <span className="bg-ok-bg text-ok rounded-full px-2.25 py-0.75 text-xs font-semibold">
              On job
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-ink-2 text-[13px]">No technician assigned yet</p>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to={`/escalations/${ticket.id}/assign`} />}
            >
              Assign manually
            </Button>
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
                    className="bg-surface-3 text-ink-2 flex aspect-4/3 flex-col items-center justify-center gap-1.5 rounded-md"
                  >
                    <Icon className="size-5" aria-hidden />
                    <span className="text-[11px] font-medium">{p.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-ink-2 mt-3 flex items-center gap-1.5 text-xs">
              <span className="bg-ok size-1.75 rounded-full" aria-hidden />
              Geo-tag matched ticket pincode
            </p>
          </>
        ) : (
          <p className="text-ink-2 text-[13px]">
            Not submitted yet. Proof is captured on site at job completion.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
