import { KNOWN_LEDGER_KINDS } from '@/features/earnings/ledger';
import { KIND_STYLE, kindStyle } from '@/features/earnings/kindStyle';
import type { TransactionKind } from '@/types/domain';

const ALL_KINDS: TransactionKind[] = [...KNOWN_LEDGER_KINDS, 'other'];

describe('KIND_STYLE', () => {
  it('has icon, fg and bg strings for every known kind plus "other"', () => {
    for (const kind of ALL_KINDS) {
      const style = KIND_STYLE[kind];
      expect(typeof style.icon).toBe('string');
      expect(typeof style.fg).toBe('string');
      expect(typeof style.bg).toBe('string');
      expect(style.fg).not.toBe('');
      expect(style.bg).not.toBe('');
      // Every fg/bg pair must differ — the fg carries the direction on the
      // row, and a tint the fg matches would hide it.
      expect(style.fg).not.toBe(style.bg);
    }
  });

  it('debits share one tint that no credit kind has', () => {
    const debitFgs = new Set(['penalty', 'speed_penalty'].map((k) => KIND_STYLE[k as 'penalty'].fg));
    const creditFgs = ['payout', 'travel', 'bonus', 'speed_reward', 'other'].map(
      (k) => KIND_STYLE[k as 'payout'].fg,
    );
    for (const credit of creditFgs) {
      expect(debitFgs.has(credit)).toBe(false);
    }
  });
});

describe('kindStyle', () => {
  it('resolves a known kind to its own style', () => {
    expect(kindStyle('payout')).toBe(KIND_STYLE.payout);
    expect(kindStyle('speed_penalty')).toBe(KIND_STYLE.speed_penalty);
  });

  it('falls back to the "other" style for anything else — including the shapes that', () => {
    expect(kindStyle('something_new')).toBe(KIND_STYLE.other);
    expect(kindStyle('')).toBe(KIND_STYLE.other);
    expect(kindStyle('constructor')).toBe(KIND_STYLE.other);
    expect(kindStyle('__proto__')).toBe(KIND_STYLE.other);
  });
});