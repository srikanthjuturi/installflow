import { pushRoute } from '@/features/notifications/pushRoute';

describe('pushRoute', () => {
  it('opens the job for a spare-part push', () => {
    expect(pushRoute({ type: 'job', ticketId: 't1', code: 'RGT-INST-0412' })).toBe('/job/t1');
  });

  it('opens a pool offer masked', () => {
    expect(pushRoute({ type: 'pool', ticketId: 't1' })).toBe('/pool/t1');
  });

  it('opens a redemption by its own id', () => {
    expect(pushRoute({ type: 'redemption', redemptionId: 'r1' })).toBe('/redeem/r1');
    expect(pushRoute({ type: 'redemption' })).toBeNull();
  });

  it('opens the payout account for a UPI change', () => {
    expect(pushRoute({ type: 'upi_change' })).toBe('/payout-account');
  });

  it('does nothing for a job push with no ticket, an unknown type or junk', () => {
    expect(pushRoute({ type: 'job' })).toBeNull();
    expect(pushRoute({ type: 'job', ticketId: 42 })).toBeNull();
    expect(pushRoute({ type: 'part' })).toBeNull();
    expect(pushRoute({ type: 'part', ticketId: 't1' })).toBeNull();
    expect(pushRoute(null)).toBeNull();
    expect(pushRoute(undefined)).toBeNull();
    expect(pushRoute('x')).toBeNull();
  });
});
