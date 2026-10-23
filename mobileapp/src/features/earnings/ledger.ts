import type { LedgerDirection, Transaction, TransactionKind } from '@/types/domain';
import { formatPaise, formatSignedPaise } from '@/utils/money';

export const KNOWN_LEDGER_KINDS = [
  'payout', 'bonus', 'penalty', 'travel', 'speed_reward', 'speed_penalty',
] as const satisfies readonly TransactionKind[];

/** Total: any input → a kind this build can draw. Never throws. */
export function toTransactionKind(raw: unknown): TransactionKind {
  return typeof raw === 'string' && (KNOWN_LEDGER_KINDS as readonly string[]).includes(raw)
    ? (raw as TransactionKind)
    : 'other';
}

const DIRECTION = {
  payout: 'credit', bonus: 'credit', travel: 'credit', speed_reward: 'credit',
  penalty: 'debit', speed_penalty: 'debit',
  other: 'unknown',
} as const satisfies Record<TransactionKind, LedgerDirection>;

export function kindDirection(kind: TransactionKind): LedgerDirection {
  return DIRECTION[kind];
}

/**
 * The server sends a magnitude; the sign is applied here, once. Defensive
 * `abs` — a server that ever sends a signed penalty does not get to double it.
 */
export function signedPaise(direction: LedgerDirection, magnitude: number): number {
  const abs = Math.abs(magnitude);
  return direction === 'debit' ? -abs : abs;
}

/** "+₹40" · "−₹300" · and "₹40" with no sign for a kind whose direction is unknown. */
export function formatLedgerAmount(t: Pick<Transaction, 'direction' | 'amountPaise'>): string {
  return t.direction === 'unknown'
    ? formatPaise(Math.abs(t.amountPaise))
    : formatSignedPaise(t.amountPaise);
}

/**
 * What `GET /earnings/transactions` returns per row. `kind` is a STRING: the server's
 * vocabulary grows without asking this build.
 */
export interface TransactionDto {
  id: string;
  at: string;
  kind: string;
  amountPaise: number;
  title: string;
  subtitle: string;
  ticketCode: string;
  ticketId?: string | null;
}

export function toTransaction(dto: TransactionDto): Transaction {
  const kind = toTransactionKind(dto.kind);
  const direction = kindDirection(kind);
  return {
    id: dto.id,
    kind,
    direction,
    title: dto.title,
    at: dto.at,
    ticketCode: dto.ticketCode,
    amountPaise: signedPaise(direction, dto.amountPaise),
    ticketId: dto.ticketId ?? null,
  };
}