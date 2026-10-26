import { cleanPincode, isPincode } from '@/features/base-location/lib/pincode';

describe('cleanPincode', () => {
  it('keeps digits only', () => {
    expect(cleanPincode('50 00-49x')).toBe('500049');
  });

  it('keeps the first six digits', () => {
    expect(cleanPincode('5000491')).toBe('500049');
  });
});

describe('isPincode', () => {
  it('accepts six digits that do not start with zero', () => {
    expect(isPincode('500049')).toBe(true);
  });

  it.each(['050004', '50004', '5000490', ''])('refuses %p', (text) => {
    expect(isPincode(text)).toBe(false);
  });
});
