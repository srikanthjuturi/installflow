import { asRedeemRefusal } from '../refusals';

describe('asRedeemRefusal', () => {
  it('returns each refusal this build knows', () => {
    expect(asRedeemRefusal('BALANCE_CHANGED')).toBe('BALANCE_CHANGED');
    expect(asRedeemRefusal('NO_UPI_ID')).toBe('NO_UPI_ID');
    expect(asRedeemRefusal('NOTHING_TO_REDEEM')).toBe('NOTHING_TO_REDEEM');
    expect(asRedeemRefusal('REDEMPTION_OPEN')).toBe('REDEMPTION_OPEN');
    // Sixth status this build knows: an employee has no Redeem at all.
    expect(asRedeemRefusal('EMPLOYEE_CANNOT_REDEEM')).toBe('EMPLOYEE_CANNOT_REDEEM');
  });

  it('returns null for a code it has never heard of — the message still shows', () => {
    expect(asRedeemRefusal('PARTS_PENDING')).toBeNull();
    expect(asRedeemRefusal('SOMETHING_NEW_LATER')).toBeNull();
  });

  it('returns null for non-strings, including the shapes a bracket read would pick up', () => {
    expect(asRedeemRefusal(undefined)).toBeNull();
    expect(asRedeemRefusal(null)).toBeNull();
    expect(asRedeemRefusal(42)).toBeNull();
    expect(asRedeemRefusal('constructor')).toBeNull();
  });
});