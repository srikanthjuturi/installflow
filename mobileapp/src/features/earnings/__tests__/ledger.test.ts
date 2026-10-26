import {
  KNOWN_LEDGER_KINDS,
  formatLedgerAmount,
  kindDirection,
  signedPaise,
  toTransaction,
  toTransactionKind,
} from '@/features/earnings/ledger';

describe('toTransactionKind', () => {
  it('maps each kind this build knows to itself', () => {
    for (const kind of KNOWN_LEDGER_KINDS) {
      expect(toTransactionKind(kind)).toBe(kind);
    }
  });

  it('maps every other input to "other"', () => {
    for (const raw of ['reversal', 'something_new', '', 'constructor', '__proto__', null, undefined, 42]) {
      expect(toTransactionKind(raw)).toBe('other');
    }
  });
});

describe('kindDirection', () => {
  it('reads credit for the pay kinds', () => {
    expect(kindDirection('payout')).toBe('credit');
    expect(kindDirection('bonus')).toBe('credit');
    expect(kindDirection('travel')).toBe('credit');
    expect(kindDirection('speed_reward')).toBe('credit');
  });

  it('reads debit for the penalty kinds', () => {
    expect(kindDirection('penalty')).toBe('debit');
    expect(kindDirection('speed_penalty')).toBe('debit');
  });

  it('reads unknown for "other"', () => {
    expect(kindDirection('other')).toBe('unknown');
  });
});

describe('signedPaise', () => {
  /** The API's note on `ledger_entries`: the server stores a magnitude — the
   *  same row is money IN to the company's pool — and the app applies the sign
   *  once, where it can be seen. */
  it('negates a debit magnitude, once', () => {
    expect(signedPaise('debit', 30000)).toBe(-30000);
    expect(signedPaise('debit', -30000)).toBe(-30000); // defensive abs, not a double sign
  });

  it('leaves a credit positive', () => {
    expect(signedPaise('credit', 4000)).toBe(4000);
  });

  it('leaves an unknown magnitude positive (the row is drawn unsigned)', () => {
    expect(signedPaise('unknown', 5000)).toBe(5000);
  });
});

describe('toTransaction', () => {
  const base = {
    id: 'le-1',
    at: '2026-10-20T10:00:00+05:30',
    title: 'Install · Sunview 43',
    subtitle: 'Today · RGT-INST-0012',
    ticketCode: 'RGT-INST-0012',
  };

  it('signs a penalty negative', () => {
    const txn = toTransaction({ ...base, kind: 'penalty', amountPaise: 30000 });
    expect(txn.kind).toBe('penalty');
    expect(txn.direction).toBe('debit');
    expect(txn.amountPaise).toBe(-30000);
  });

  it('signs a speed penalty negative', () => {
    const txn = toTransaction({ ...base, kind: 'speed_penalty', amountPaise: 15000 });
    expect(txn.kind).toBe('speed_penalty');
    expect(txn.direction).toBe('debit');
    expect(txn.amountPaise).toBe(-15000);
  });

  it('leaves a travel allowance positive', () => {
    const txn = toTransaction({ ...base, kind: 'travel', amountPaise: 4000 });
    expect(txn.kind).toBe('travel');
    expect(txn.direction).toBe('credit');
    expect(txn.amountPaise).toBe(4000);
  });

  it('maps a kind this build has never heard of to other/unsigned-positive', () => {
    const txn = toTransaction({ ...base, kind: 'something_new', amountPaise: 5000 });
    expect(txn.kind).toBe('other');
    expect(txn.direction).toBe('unknown');
    expect(txn.amountPaise).toBe(5000);
    expect(txn.title).toBe(base.title);
  });

  it('absorbs a negative magnitude from the server (abs, then sign)', () => {
    const txn = toTransaction({ ...base, kind: 'penalty', amountPaise: -500 });
    expect(txn.amountPaise).toBe(-500);
  });

  it('collapses a missing ticketId to null', () => {
    expect(toTransaction({ ...base, kind: 'payout', amountPaise: 45000 }).ticketId).toBeNull();
  });

  it('keeps ticketId for a job still openable', () => {
    const { ticketId } = toTransaction({ ...base, kind: 'payout', amountPaise: 45000, ticketId: 'job-1' });
    expect(ticketId).toBe('job-1');
  });
});

describe('formatLedgerAmount', () => {
  it('shows a credit signed', () => {
    expect(formatLedgerAmount({ direction: 'credit', amountPaise: 4000 })).toBe('+₹40');
  });

  it('shows a debit signed', () => {
    expect(formatLedgerAmount({ direction: 'debit', amountPaise: -30000 })).toBe('−₹300');
  });

  it('shows an unknown kind unsigned', () => {
    expect(formatLedgerAmount({ direction: 'unknown', amountPaise: 5000 })).toBe('₹50');
  });
});