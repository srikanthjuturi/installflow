import type { TicketDetail } from "@/services/tickets";

/** The eight facts that define the ticket, in the prototype's order. */
export function FactGrid({ ticket }: { ticket: TicketDetail }) {
  const facts: Array<[string, string]> = [
    ["Vendor", ticket.vendor],
    ["Category", ticket.category],
    ["Product model", ticket.product],
    ["SLA type", ticket.slaType],
    ["Pincode", ticket.pincode],
    ["Expected date", ticket.expected],
    ["Created", ticket.created],
    ["Confirmed slot", ticket.slot],
  ];

  return (
    // 1px gap over a tinted background draws the hairline grid without
    // per-cell borders doubling up.
    <dl className="border-line-2 bg-line-2 mt-4.5 grid grid-cols-2 gap-px overflow-hidden rounded-md border sm:grid-cols-4">
      {facts.map(([k, v]) => (
        <div key={k} className="bg-surface px-3.5 py-3">
          <dt className="text-ink-3 text-[11px]">{k}</dt>
          <dd className="mt-1 text-[13px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
