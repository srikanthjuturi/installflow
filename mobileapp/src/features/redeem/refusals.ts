// src/features/redeem/refusals.ts — pure, so it is testable without `lib/api`.

/** Why a request was refused — each leads somewhere different on screen. */
export type RedeemRefusal =
  | 'BALANCE_CHANGED' | 'NO_UPI_ID' | 'NOTHING_TO_REDEEM' | 'REDEMPTION_OPEN'
  | 'EMPLOYEE_CANNOT_REDEEM';

const REFUSALS: readonly RedeemRefusal[] = [
  'BALANCE_CHANGED', 'NO_UPI_ID', 'NOTHING_TO_REDEEM', 'REDEMPTION_OPEN', 'EMPLOYEE_CANNOT_REDEEM',
];

/** Total: any wire `code` → a refusal the build knows, or null for one it does not. */
export function asRedeemRefusal(code: unknown): RedeemRefusal | null {
  return REFUSALS.find((c) => c === code) ?? null;
}