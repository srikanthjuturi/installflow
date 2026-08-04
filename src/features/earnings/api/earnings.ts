import { earnings, transactions } from '@/mocks/db';
import { delay } from '@/mocks/delay';
import type { EarningsSummary, Transaction } from '@/types/domain';

/** Binding phase: `GET /earnings/summary?period=week`. */
export async function getEarningsSummary(): Promise<EarningsSummary> {
  await delay('earnings:summary');
  return earnings;
}

/** Binding phase: `GET /earnings/transactions` (paginated). */
export async function listTransactions(): Promise<Transaction[]> {
  await delay('earnings:transactions');
  return transactions;
}
