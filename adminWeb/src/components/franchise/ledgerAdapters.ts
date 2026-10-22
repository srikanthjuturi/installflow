/**
 * Pure adapters between a ledger ENTRY and the ticket page's reversal dialog —
 * Task 09 §5.5. `ReversePenaltyDialog` is built for a `TicketPenalty` lifted
 * off a ticket read, but the franchisee's pool screen (§4.3) reverses straight
 * from a `LedgerEntry` row, so the shape is translated in one place and tested
 * there (`ledgerAdapters.test.ts`) rather than improvised at the call site.
 */

import type { LedgerEntry } from "@/types";
import type { TicketPenalty } from "@/types/ticket";
import { slug } from "@/utils/slug";

/**
 * The kinds a reversal can take back. Today only `penalty` is ever in the
 * pool; `speed_penalty` is the same money a later task charges, so the row
 * learns to render its button now and the wire grows into it. Everything else
 * — a bonus, `reversal` itself, and kinds the pool never carries — is not the
 * entry the reader is looking at when they ask to give money back.
 */
export const REVERSIBLE_KINDS: readonly LedgerEntry["kind"][] = [
  "penalty",
  "speed_penalty",
];

/**
 * Can THIS entry be given back: its kind is one of the above and no reversal
 * has already taken it — the entry's own `reversed` tag, which the server
 * re-checks with 409 `PENALTY_ALREADY_REVERSED` for anyone who raced a stale
 * table.
 */
export function isReversible(e: LedgerEntry): boolean {
  return !e.reversed && REVERSIBLE_KINDS.includes(e.kind);
}

/**
 * The ledger row, dressed as the dialog's subject. The reversal fields are
 * null because this is only ever called on a row `isReversible` has already
 * passed — a reversed entry renders no button to reach the dialog through.
 */
export function toTicketPenalty(e: LedgerEntry): TicketPenalty {
  return {
    id: e.id,
    technicianName: e.technicianName,
    amountPaise: e.amountPaise,
    reason: e.reason,
    chargedAt: e.at,
    reversedAt: null,
    reversedByName: null,
    reversalReason: null,
    /**
     * Task 05's per-row answer, in the ledger row's own vocabulary: the entry
     * carries no `canReverse` of its own (that is a ticket read's field), and
     * the caller has already gated on it. The pool screen's version of "may
     * this row be given back" is exactly `isReversible` — kind and not yet
     * reversed — so the dialog's subject says the same thing in its own type.
     */
    canReverse: isReversible(e),
  };
}

/**
 * The ledger CSV's download name. It names the company — someone who works
 * across two of them ends up with both files in one Downloads folder — and,
 * in the franchise workspace, the franchisee too, where the company's name
 * alone is claimed twice over. Pure, so `LedgerTable` and any future caller
 * name their exports identically.
 */
export function ledgerFileName(company: string, franchisee?: string): string {
  const parts = franchisee
    ? [slug(company), slug(franchisee)]
    : [slug(company)];
  return `${parts.join("-")}-ledger.csv`;
}