import type { ParseKeys } from 'i18next';

import type { JobSpeed, JobTravel } from '@/types/domain';

/** One row of the Allowances card — keys and params; the card calls `t()`. */
export interface AllowanceLine {
  key: ParseKeys;
  params?: Record<string, string>;
  /** `setBase` renders the "Set base location" link (Task 14's screen). */
  action?: 'setBase';
}

/** 27 → "27", 28.1 → "28.1", 12.04 → "12". One decimal, trailing ".0" dropped. */
function kmLabel(km: number): string {
  return String(Math.round(km * 10) / 10);
}

/**
 * The travel row, from the frozen block. The AMOUNT is the server's — nothing
 * is computed here. Null/undefined (no block: a pool offer, an older API, a job
 * accepted before travel allowances) draws no row at all.
 */
export function travelLine(
  t: JobTravel | null | undefined,
  fmt: (paise: number) => string,
): AllowanceLine | null {
  if (!t) return null;
  if (t.reason === 'no_base_location') {
    return { key: 'jobs.allowances.travelNoBase', action: 'setBase' };
  }
  if (t.reason === 'no_customer_point') {
    return { key: 'jobs.allowances.travelNoCustomer' };
  }
  const km = kmLabel(t.km);
  if (t.amountPaise > 0) {
    return { key: 'jobs.allowances.travel', params: { km, amount: fmt(t.amountPaise) } };
  }
  return { key: 'jobs.allowances.travelNone', params: { km } };
}

/**
 * The speed rows: what finishing fast earns, what finishing slow costs, and
 * ONE note on where the clock starts (owner ruling R1). Both amounts 0 means
 * speed is switched off for this product — no rows and no note.
 *
 * An older server omits `clockFromSlot`; that reads as "from the accept".
 */
export function speedLines(
  s: JobSpeed | null | undefined,
  fmt: (paise: number) => string,
): AllowanceLine[] {
  if (!s) return [];
  const lines: AllowanceLine[] = [];
  if (s.rewardPaise > 0) {
    lines.push({
      key: 'jobs.allowances.speedReward',
      params: { hours: String(s.rewardWithinHours), amount: fmt(s.rewardPaise) },
    });
  }
  if (s.penaltyPaise > 0) {
    lines.push({
      key: 'jobs.allowances.speedPenalty',
      params: { hours: String(s.penaltyAfterHours), amount: fmt(s.penaltyPaise) },
    });
  }
  if (lines.length === 0) return [];
  lines.push({
    key: s.clockFromSlot === true
      ? 'jobs.allowances.speedNoteSlot'
      : 'jobs.allowances.speedNoteAccept',
  });
  return lines;
}
