import { authedRequest } from '@/lib/api';
import type {
  EarningsPeriod,
  EarningsSummary,
  Transaction,
  TransactionKind,
} from '@/types/domain';

/**
 * Earnings — real, and honest about the half that does not exist yet.
 *
 *   getEarningsSummary → GET /earnings/summary?period=day|week|month
 *   listTransactions   → GET /earnings/transactions?period=…
 *
 * Both are scoped to the signed-in technician by the server; there is no id to
 * pass and no way to ask about anybody else.
 *
 * ## `net` and `earned` come back NULL, on purpose
 *
 * Nothing prices an install. `tickets` has no payout column, so what the JOBS
 * pay is unknown — and with it unknown, so is the net. `formatPaise` renders
 * both as "—", which is the same thing `payoutPaise` has done on every job
 * card since the pool bound.
 *
 * The tempting substitute is bonuses minus penalties. It would be worse than
 * a dash: a technician who cancelled once and earned no bonus would open this
 * screen to −₹300 presented as their week's pay, having done five installs
 * nothing has counted.
 */

interface SummaryDto {
  netPaise: number | null;
  earnedPaise: number | null;
  bonusesPaise: number;
  penaltiesPaise: number;
}

interface TransactionDto {
  id: string;
  at: string;
  kind: TransactionKind;
  /** Always POSITIVE — the server sends a magnitude and `kind` the direction. */
  amountPaise: number;
  title: string;
  subtitle: string;
  ticketCode: string;
}

export async function getEarningsSummary(
  period: EarningsPeriod,
): Promise<EarningsSummary> {
  const dto = await authedRequest<SummaryDto>(`/earnings/summary?period=${period}`);
  return {
    netPaise: dto.netPaise,
    earnedPaise: dto.earnedPaise,
    bonusesPaise: dto.bonusesPaise,
    penaltiesPaise: dto.penaltiesPaise,
  };
}

export async function listTransactions(
  period: EarningsPeriod,
): Promise<Transaction[]> {
  const rows = await authedRequest<TransactionDto[]>(
    `/earnings/transactions?period=${period}`,
  );
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    subtitle: t.subtitle,
    // The SIGN is applied here, once, and this is the technician's own screen:
    // a penalty is money out of their pocket. The server stores a magnitude
    // because the same row is money IN to the company's pool — see the API's
    // note on `ledger_entries`.
    amountPaise: t.kind === 'penalty' ? -t.amountPaise : t.amountPaise,
  }));
}
