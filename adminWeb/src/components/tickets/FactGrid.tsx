import { EMPTY, formatDate, formatDateTime, formatSlot } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import type { TicketDetail } from "@/types/ticket";

/**
 * The facts that define the ticket — the prototype's eight, plus the four
 * intake now collects: what kind of job it is, the customer's problem, the
 * serial to check against, and an address to actually arrive at.
 *
 * **This component is shared with the vendor portal**, which is why the two
 * money rows are built the way they are. `vendorPricePaise` is unconditional —
 * it is the vendor's own price and ops need to see it too. The technician's
 * payout is appended only when the server actually sent one, and for a vendor
 * it never does; the condition is not a permission check (that is the server's
 * job) but the natural way to render a field that is legitimately absent.
 */
export function FactGrid({ ticket }: { ticket: TicketDetail }) {
  const facts: Array<[string, string]> = [
    ["Vendor", ticket.vendorName],
    ["Category", ticket.subcategoryName],
    ["Product model", ticket.modelName],
    ["Service type", ticket.serviceType],
    ["Service level", `${ticket.serviceLevelHours}h`],
    // Only ever present for Tech Visit and Service.
    ["Problem", ticket.description ?? EMPTY],
    ["Expected serial", ticket.serialNumber ?? EMPTY],
    ["Address", `${ticket.address}, ${ticket.city}, ${ticket.state}`],
    ["Pincode", ticket.pincode],
    ["Expected date", formatDate(ticket.expectedDate)],
    ["Created", formatDateTime(ticket.createdAt)],
    ["Confirmed slot", formatSlot(ticket.slotStart, ticket.slotEnd)],
    ["Billed to vendor", moneyPaise(ticket.vendorPricePaise)],
  ];

  if (ticket.technicianPayoutPaise !== null) {
    facts.push(["Technician payout", moneyPaise(ticket.technicianPayoutPaise)]);
    // What was actually PAID, which a force-closure can set below the payout
    // above. Null until the job closes, and "—" is the right answer then:
    // nothing has been credited yet, which is not the same as ₹0.
    facts.push([
      "Credited",
      moneyPaise(ticket.technicianCreditedPaise),
    ]);
  }

  return (
    // 1px gap over a tinted background draws the hairline grid without
    // per-cell borders doubling up.
    <dl className="mt-4.5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-2 bg-line-2 sm:grid-cols-4">
      {facts.map(([k, v]) => (
        <div key={k} className="bg-surface px-3.5 py-3">
          <dt className="text-[11px] text-ink-3">{k}</dt>
          <dd className="mt-1 text-[13px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
