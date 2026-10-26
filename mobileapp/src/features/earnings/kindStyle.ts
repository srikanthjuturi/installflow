import type { IconName } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import type { TransactionKind } from '@/types/domain';

export interface KindStyle { icon: IconName; fg: string; bg: string }

/** A debit must never skim as a credit: debit kinds share `ledgerDebit`, and no credit kind does. */
export const KIND_STYLE = {
  payout:        { icon: 'card',       ...color.ledgerCredit },
  travel:        { icon: 'navigation', ...color.ledgerCredit },
  bonus:         { icon: 'gift',       ...color.ledgerBonus },
  speed_reward:  { icon: 'zap',        ...color.ledgerBonus },
  penalty:       { icon: 'warn',       ...color.ledgerDebit },
  speed_penalty: { icon: 'clock',      ...color.ledgerDebit },
  other:         { icon: 'info',       ...color.ledgerOther },
} as const satisfies Record<TransactionKind, KindStyle>;

/** Any string → a style. Own-property test, so `'constructor'` falls back too. */
export function kindStyle(kind: string): KindStyle {
  return Object.prototype.hasOwnProperty.call(KIND_STYLE, kind)
    ? KIND_STYLE[kind as TransactionKind]
    : KIND_STYLE.other;
}