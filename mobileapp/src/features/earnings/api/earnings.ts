import { toTransaction, type TransactionDto } from '@/features/earnings/ledger';
import { authedRequest } from '@/lib/api';
import type {
  EarningsSummary,
  EarningsWindow,
  Transaction,
} from '@/types/domain';

/**
 * Earnings — all four figures real.
 *
 *   getEarningsSummary → GET /earnings/summary?period=day|week|month
 *                        GET /earnings/summary?dateFrom=…&dateTo=…
 *   listTransactions   → the same two shapes
 *
 * Both are scoped to the signed-in technician by the server; there is no id to
 * pass and no way to ask about anybody else.
 *
 * ## The arithmetic
 *
 *   net = earned + bonuses − penalties
 *
 * All four are summed from `ledger_entries` in ONE grouped query over one
 * window. From Task 10 onward the server folds every kind into those three
 * before dividing — travel into `earned` (it is pay for the job) and
 * speed_reward / speed_penalty into `bonuses` / `penalties` — so the tiles
 * never miss a kind. Penalties arrive POSITIVE — a magnitude, with `kind`
 * carrying the direction — and the sign is applied where it can be seen, in
 * `signedPaise` (`features/earnings/ledger.ts`).
 *
 * `net` and `earned` were null until installs were priced, and this comment
 * used to explain why. The refusal is still worth remembering: substituting
 * bonuses minus penalties in the meantime would have shown a technician who
 * cancelled once and did five unpriced installs −₹300 as their week's pay.
 */

interface SummaryDto {
  netPaise: number;
  earnedPaise: number;
  bonusesPaise: number;
  penaltiesPaise: number;
  /**
   * OPTIONAL on the wire, and it has to be: a server that predates the date
   * range sends neither, and the screen's whole reason for reading them is to
   * notice exactly that. See `EarningsSummary.covered`.
   */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The query string for a window — and, because it is exactly what makes one
 * answer different from another, its cache key too.
 *
 * Dates are already `YYYY-MM-DD`, which needs no encoding; spelling that out
 * here so nobody adds a field later that does.
 */
export function windowQuery(window: EarningsWindow): string {
  return window.kind === 'period'
    ? `period=${window.period}`
    : `dateFrom=${window.range.from}&dateTo=${window.range.to}`;
}

export async function getEarningsSummary(
  window: EarningsWindow,
): Promise<EarningsSummary> {
  const dto = await authedRequest<SummaryDto>(
    `/earnings/summary?${windowQuery(window)}`,
  );
  return {
    netPaise: dto.netPaise,
    earnedPaise: dto.earnedPaise,
    bonusesPaise: dto.bonusesPaise,
    penaltiesPaise: dto.penaltiesPaise,
    // Both or neither — half an answer is not a span, and treating one end as
    // a window would caption the money with a date the server never named.
    covered:
      dto.dateFrom && dto.dateTo ? { from: dto.dateFrom, to: dto.dateTo } : null,
  };
}

export async function listTransactions(
  window: EarningsWindow,
): Promise<Transaction[]> {
  const rows = await authedRequest<TransactionDto[]>(
    `/earnings/transactions?${windowQuery(window)}`,
  );
  return rows.map(toTransaction);
}