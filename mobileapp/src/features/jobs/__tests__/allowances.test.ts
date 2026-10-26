import { speedLines, travelLine } from '@/features/jobs/allowances';
import type { JobSpeed } from '@/types/domain';
import { formatPaise } from '@/utils/money';

const speed = (over: Partial<JobSpeed> = {}): JobSpeed => ({
  rewardWithinHours: 12,
  penaltyAfterHours: 24,
  rewardPaise: 20000,
  penaltyPaise: 0,
  clockStartedAt: '2026-10-15T05:30:00Z',
  ...over,
});

describe('travelLine', () => {
  it('draws nothing without a block', () => {
    expect(travelLine(undefined, formatPaise)).toBeNull();
    expect(travelLine(null, formatPaise)).toBeNull();
  });

  it('says the base was not set, and offers to set it', () => {
    expect(travelLine({ km: 0, amountPaise: 0, reason: 'no_base_location' }, formatPaise)).toEqual({
      key: 'jobs.allowances.travelNoBase',
      action: 'setBase',
    });
  });

  it('says the customer point is unknown', () => {
    expect(
      travelLine({ km: 0, amountPaise: 0, reason: 'no_customer_point' }, formatPaise),
    ).toEqual({ key: 'jobs.allowances.travelNoCustomer' });
  });

  it('words km and the server amount', () => {
    expect(travelLine({ km: 27, amountPaise: 7000, reason: null }, formatPaise)).toEqual({
      key: 'jobs.allowances.travel',
      params: { km: '27', amount: '₹70' },
    });
  });

  it('keeps one decimal and drops a trailing .0', () => {
    expect(travelLine({ km: 28.1, amountPaise: 7000, reason: null }, formatPaise)?.params?.km).toBe(
      '28.1',
    );
    expect(travelLine({ km: 27.04, amountPaise: 7000, reason: null }, formatPaise)?.params?.km).toBe(
      '27',
    );
  });

  it('says there is no allowance when the amount is 0', () => {
    expect(travelLine({ km: 12, amountPaise: 0, reason: null }, formatPaise)).toEqual({
      key: 'jobs.allowances.travelNone',
      params: { km: '12' },
    });
  });
});

describe('speedLines', () => {
  it('draws nothing without a rule', () => {
    expect(speedLines(null, formatPaise)).toEqual([]);
    expect(speedLines(undefined, formatPaise)).toEqual([]);
  });

  it('a reward counted from the slot ends with the slot note', () => {
    const lines = speedLines(speed({ clockFromSlot: true }), formatPaise);
    expect(lines.map((l) => l.key)).toEqual([
      'jobs.allowances.speedReward',
      'jobs.allowances.speedNoteSlot',
    ]);
    expect(lines[0]?.params).toEqual({ hours: '12', amount: '₹200' });
  });

  it('counts from the accept when the flag is false or absent', () => {
    for (const flag of [false, undefined]) {
      const lines = speedLines(speed({ clockFromSlot: flag }), formatPaise);
      expect(lines.map((l) => l.key)).toEqual([
        'jobs.allowances.speedReward',
        'jobs.allowances.speedNoteAccept',
      ]);
    }
  });

  it('shows reward, penalty and one note when both apply', () => {
    const lines = speedLines(speed({ penaltyPaise: 15000, clockFromSlot: true }), formatPaise);
    expect(lines.map((l) => l.key)).toEqual([
      'jobs.allowances.speedReward',
      'jobs.allowances.speedPenalty',
      'jobs.allowances.speedNoteSlot',
    ]);
    expect(lines[1]?.params).toEqual({ hours: '24', amount: '₹150' });
  });

  it('a penalty alone still gets its note', () => {
    const lines = speedLines(speed({ rewardPaise: 0, penaltyPaise: 15000 }), formatPaise);
    expect(lines.map((l) => l.key)).toEqual([
      'jobs.allowances.speedPenalty',
      'jobs.allowances.speedNoteAccept',
    ]);
  });

  it('is empty when speed is switched off (0 and 0)', () => {
    expect(speedLines(speed({ rewardPaise: 0, penaltyPaise: 0 }), formatPaise)).toEqual([]);
  });
});
