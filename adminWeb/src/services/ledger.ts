import { mockPage, mockResponse, sortRows } from "./client";
import type { ListParams, Page } from "@/types/api";
import type { LedgerEntry } from "@/types";

/**
 * §7 — the pool is not two unrelated numbers.
 *
 * Cancellation penalties are *collected into* a pool, and that same pool is
 * what *funds* the bonus paid to whoever picks up an escalated ticket. Money in
 * equals money out: `balance === penaltiesCollected - bonusesPaid`. The screen
 * shows that arithmetic rather than three standalone tiles.
 */
export interface LedgerPool {
  /** Unspent penalty money. This is what a bonus is drawn against. */
  balance: number;
  /** Positive here — the debit sign lives on the individual entries. */
  penaltiesCollected: number;
  cancellations: number;
  bonusesPaid: number;
  pickups: number;
}

const POOL: LedgerPool = {
  balance: 18400,
  penaltiesCollected: 24200,
  cancellations: 41,
  bonusesPaid: 5800,
  pickups: 12,
};

/**
 * Penalty amounts are negative — a debit against the technician that flows
 * into the pool. Bonus amounts are positive — a credit paid out of it.
 *
 * The bands these penalties came from (₹300 / ₹500 / ₹800) are the prototype's
 * and contradict the technician app's ₹80 / ₹150 / ₹250. That contradiction is
 * a logged open decision, not something to reconcile here.
 */
const LEDGER: LedgerEntry[] = [
  {
    id: "LG-8841",
    date: "Aug 4",
    type: "Penalty",
    tech: "Prakash Jadhav",
    ticket: "INST-240940",
    amt: -800,
    reason: "Cancel <2h before slot",
  },
  {
    id: "LG-8840",
    date: "Aug 4",
    type: "Bonus",
    tech: "Ganesh More",
    ticket: "INST-240951",
    amt: 400,
    reason: "Escalation pickup",
  },
  {
    id: "LG-8838",
    date: "Aug 3",
    type: "Penalty",
    tech: "Imran Shaikh",
    ticket: "INST-240889",
    amt: -500,
    reason: "Cancel 2–4h before slot",
  },
  {
    id: "LG-8835",
    date: "Aug 3",
    type: "Bonus",
    tech: "Vijay Sawant",
    ticket: "INST-240871",
    amt: 600,
    reason: "Escalation pickup",
  },
  {
    id: "LG-8829",
    date: "Aug 2",
    type: "Penalty",
    tech: "Amit Borkar",
    ticket: "INST-240822",
    amt: -300,
    reason: "Cancel >4h before slot",
  },
  {
    id: "LG-8820",
    date: "Aug 2",
    type: "Bonus",
    tech: "Sunil Pawar",
    ticket: "INST-240810",
    amt: 500,
    reason: "Escalation pickup",
  },
];

const ALL = "All";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "Aug 4" → a comparable number. Sorting the label itself would file "Aug 2"
 * ahead of "Jul 30", because the collator only sees the letters.
 *
 * A real backend orders on a timestamp column and never needs this — it exists
 * because the mock rows carry the display label the prototype shows.
 */
function dateKey(date: string): number | null {
  const [month, day] = date.trim().split(/\s+/);
  const index = MONTHS.indexOf(month ?? "");
  return index === -1 ? null : index * 100 + Number(day ?? 0);
}

/** Sort keys, keyed by DataTable column id so `sortBy` round-trips. */
const LEDGER_SORT: Record<string, (l: LedgerEntry) => string | number | null> =
  {
    date: (l) => dateKey(l.date),
    type: (l) => l.type,
    // The raw signed number, never the money() string — otherwise −₹800 would
    // sort as text and land above ₹400.
    amt: (l) => l.amt,
  };

export function getLedgerPool(): Promise<LedgerPool> {
  return mockResponse(() => POOL);
}

export function listLedgerEntries(
  params: ListParams = {}
): Promise<Page<LedgerEntry>> {
  return mockPage(() => {
    const type = params.filters?.type;
    const rows = LEDGER.filter((l) => !type || type === ALL || l.type === type);

    // Entry id breaks ties, so two rows dated "Aug 4" hold their order across
    // refetches — a ledger that reshuffles is a ledger nobody trusts.
    return sortRows(
      [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      params.sortBy,
      params.sortDir,
      LEDGER_SORT
    );
  }, params);
}
