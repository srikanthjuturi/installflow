import { cardState } from '../cardState';

describe('cardState', () => {
  it('hides the on-hold line when nothing is held or the server omits it', () => {
    expect(cardState({ availablePaise: 5000, redeemablePaise: 5000 }).showOnHold).toBe(false);
    expect(
      cardState({ availablePaise: 5000, redeemablePaise: 5000, holdingPaise: 0 }).showOnHold,
    ).toBe(false);
  });

  it('shows the on-hold line when something is held', () => {
    const s = cardState({ availablePaise: 5000, redeemablePaise: 3000, holdingPaise: 2000 });
    expect(s.showOnHold).toBe(true);
    expect(s.onHoldPaise).toBe(2000);
    expect(s.canRedeem).toBe(true);
    expect(s.hintKey).toBeNull();
  });

  it('says the minimum, not "nothing", when the net is below it', () => {
    const s = cardState({
      availablePaise: 5000,
      redeemablePaise: 0,
      holdingPaise: 2000,
      minRedeemablePaise: 10000,
    });
    expect(s.canRedeem).toBe(false);
    expect(s.belowMinimum).toBe(true);
    expect(s.minPaise).toBe(10000);
    expect(s.hintKey).toBe('redeem.card.belowMinimum');
  });

  it('says "nothing to redeem" when there is no minimum', () => {
    const s = cardState({ availablePaise: 0, redeemablePaise: 0 });
    expect(s.canRedeem).toBe(false);
    expect(s.belowMinimum).toBe(false);
    expect(s.hintKey).toBe('redeem.card.nothing');
  });

  it('enables the button only when redeemablePaise is above zero', () => {
    expect(
      cardState({ availablePaise: 20000, redeemablePaise: 20000, minRedeemablePaise: 10000 })
        .canRedeem,
    ).toBe(true);
    expect(cardState({ availablePaise: 20000, redeemablePaise: 0 }).canRedeem).toBe(false);
  });
});
