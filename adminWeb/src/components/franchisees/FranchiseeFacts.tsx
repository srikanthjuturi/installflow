import type React from "react";
import { formatDateTime } from "@/utils/datetime";
import { formatPhone } from "@/utils/phone";
import type { Franchisee } from "@/types/franchisee";
import { wireKindToWord } from "./franchiseeKind";

const NONE = "—";

/**
 * The detail page's Details card — the seven facts, answered even where the
 * answer is "—" (root AGENTS: a blank line renders as a dash, never as 0 or a
 * guess).
 *
 * The home note rides on the card because the home page's whole story is here:
 * it owns nothing it can NAME — its `pincodeRanges` is "" by shape — and the way
 * to take pincodes off it is to give them to somebody else, a sentence the
 * Pincodes card alone cannot tell.
 */
export function FranchiseeFacts({ franchisee }: { franchisee: Franchisee }) {
  const rows: Array<[string, React.ReactNode]> = [
    [
      "Code",
      <span key="code" className="font-mono">
        {franchisee.code}
      </span>,
    ],
    ["Kind", wireKindToWord(franchisee.kind)],
    ["Contact", franchisee.contactName ?? NONE],
    [
      "Phone",
      franchisee.contactPhone ? formatPhone(franchisee.contactPhone) : NONE,
    ],
    ["Email", franchisee.contactEmail ?? NONE],
    ["Status", franchisee.isActive ? "Active" : "Inactive"],
    ["Created", formatDateTime(franchisee.createdAt)],
  ];

  return (
    <section className="rounded-lg border border-line bg-surface-1">
      <h3 className="border-b border-line px-3.5 py-3 text-[15px] font-semibold text-ink">
        Details
      </h3>
      <dl className="divide-y divide-line-2 px-3.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <dt className="text-[13px] text-ink-3">{label}</dt>
            <dd className="text-[13px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {franchisee.isHome ? (
        <p className="border-t border-line px-3.5 py-3 text-[12.5px] leading-snug text-ink-2">
          The home franchisee owns every pincode no other franchisee owns. Give
          pincodes to another franchisee to take them from it.
        </p>
      ) : null}
    </section>
  );
}