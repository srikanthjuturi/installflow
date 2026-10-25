import type { EarningsSummary } from '@/types/domain';

/**
 * The "incl." lines under the three tiles (Task 15).
 *
 * Each figure is a SUBSET of the tile above it — travel is already inside
 * `earnedPaise`, a speed reward inside `bonusesPaise`, a speed penalty inside
 * `penaltiesPaise` (index §6a) — so this returns the parts and never a sum, and
 * nothing here may be added to anything. Null (the server did not say) and 0
 * both draw no line.
 */
export function breakdown(
  s: Pick<EarningsSummary, 'travelPaise' | 'speedRewardPaise' | 'speedPenaltyPaise'>,
): { earned?: number; bonuses?: number; penalties?: number } {
  const out: { earned?: number; bonuses?: number; penalties?: number } = {};
  if (s.travelPaise) out.earned = s.travelPaise;
  if (s.speedRewardPaise) out.bonuses = s.speedRewardPaise;
  if (s.speedPenaltyPaise) out.penalties = s.speedPenaltyPaise;
  return out;
}
