import { breakdown } from '@/features/earnings/breakdown';

const none = { travelPaise: null, speedRewardPaise: null, speedPenaltyPaise: null };

describe('breakdown', () => {
  it('is empty when the server sent nothing', () => {
    expect(breakdown(none)).toEqual({});
  });

  it('maps travel to the Earned tile', () => {
    expect(breakdown({ ...none, travelPaise: 7000 })).toEqual({ earned: 7000 });
  });

  it('maps a speed reward to Bonuses and a speed penalty to Penalties', () => {
    expect(breakdown({ ...none, speedRewardPaise: 20000 })).toEqual({ bonuses: 20000 });
    expect(breakdown({ ...none, speedPenaltyPaise: 15000 })).toEqual({ penalties: 15000 });
  });

  it('draws no line for zero', () => {
    expect(breakdown({ travelPaise: 0, speedRewardPaise: 0, speedPenaltyPaise: 0 })).toEqual({});
  });

  it('returns all three when all are set — and never a sum', () => {
    const out = breakdown({ travelPaise: 7000, speedRewardPaise: 20000, speedPenaltyPaise: 15000 });
    expect(out).toEqual({ earned: 7000, bonuses: 20000, penalties: 15000 });
    expect(Object.keys(out).sort()).toEqual(['bonuses', 'earned', 'penalties']);
  });
});
