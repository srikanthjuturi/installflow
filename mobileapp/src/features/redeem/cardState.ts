// src/features/redeem/cardState.ts — pure, so the card's rules are testable
// without rendering. The server does the proving; this only decides what to say.

export interface CardFigures {
  availablePaise: number;
  redeemablePaise: number;
  /** Absent from an older server — read as 0. */
  holdingPaise?: number | null;
  /** Absent from an older server — read as 0, meaning no minimum. */
  minRedeemablePaise?: number | null;
}

export interface CardState {
  /** Money a manager is holding back; 0 means the line is not drawn. */
  onHoldPaise: number;
  showOnHold: boolean;
  /** The least a request may be for; 0 means none. */
  minPaise: number;
  /** Button enabled only when the server says something can be asked for. */
  canRedeem: boolean;
  /** Available after the hold, short of a minimum that exists. */
  belowMinimum: boolean;
  /** i18n key for the disabled button's hint, or null while it is enabled. */
  hintKey: 'redeem.card.belowMinimum' | 'redeem.card.nothing' | null;
}

export function cardState(f: CardFigures): CardState {
  const onHoldPaise = Math.max(0, f.holdingPaise ?? 0);
  const minPaise = Math.max(0, f.minRedeemablePaise ?? 0);
  const canRedeem = f.redeemablePaise > 0;
  const net = f.availablePaise - onHoldPaise;
  const belowMinimum = !canRedeem && minPaise > 0 && net < minPaise;
  return {
    onHoldPaise,
    showOnHold: onHoldPaise > 0,
    minPaise,
    canRedeem,
    belowMinimum,
    hintKey: canRedeem ? null : belowMinimum ? 'redeem.card.belowMinimum' : 'redeem.card.nothing',
  };
}
