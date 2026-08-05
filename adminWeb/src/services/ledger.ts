import { mockResponse } from "./client";
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

export function getLedgerPool(): Promise<LedgerPool> {
  return mockResponse(() => POOL);
}

export function listLedgerEntries(): Promise<LedgerEntry[]> {
  return mockResponse(() => LEDGER);
}
