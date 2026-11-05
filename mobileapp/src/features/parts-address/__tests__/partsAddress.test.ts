import type { PartsAddress } from '@/features/parts-address/api/partsAddress';
import {
  EMPTY_FORM,
  digitsOnly,
  toBody,
  validatePartsAddress,
  type PartsAddressForm,
} from '@/features/parts-address/lib/schema';
import { formatPartsAddress } from '@/features/parts-address/lib/summary';

const valid = (over: Partial<PartsAddressForm> = {}): PartsAddressForm => ({
  ...EMPTY_FORM,
  line: '12 MG Road',
  city: 'Hyderabad',
  pincode: '500001',
  ...over,
});

describe('validatePartsAddress', () => {
  it('accepts the three required fields alone', () => {
    expect(validatePartsAddress(valid())).toEqual({});
  });

  it('asks for every required field when empty', () => {
    expect(Object.keys(validatePartsAddress(EMPTY_FORM)).sort()).toEqual(['city', 'line', 'pincode']);
  });

  it('refuses a short line and a one-letter city', () => {
    const errors = validatePartsAddress(valid({ line: 'ab', city: 'H' }));
    expect(errors.line).toBe('partsAddress.errors.line');
    expect(errors.city).toBe('partsAddress.errors.city');
  });

  it.each(['50000', '5000011', '050001', '50000a'])('refuses pincode %p', (pincode) => {
    expect(validatePartsAddress(valid({ pincode })).pincode).toBe('partsAddress.errors.pincode');
  });

  it('caps the line at 240 and the landmark at 120', () => {
    expect(validatePartsAddress(valid({ line: 'x'.repeat(241) })).line).toBeDefined();
    expect(validatePartsAddress(valid({ line: 'x'.repeat(240) })).line).toBeUndefined();
    expect(validatePartsAddress(valid({ landmark: 'x'.repeat(121) })).landmark).toBeDefined();
  });

  it('takes a blank phone or a ten-digit mobile, nothing else', () => {
    expect(validatePartsAddress(valid({ contactPhone: '' })).contactPhone).toBeUndefined();
    expect(validatePartsAddress(valid({ contactPhone: '9876543210' })).contactPhone).toBeUndefined();
    expect(validatePartsAddress(valid({ contactPhone: '12345' })).contactPhone).toBe(
      'partsAddress.errors.phone',
    );
    expect(validatePartsAddress(valid({ contactPhone: '1234567890' })).contactPhone).toBeDefined();
  });
});

describe('toBody', () => {
  it('trims and omits blank optional fields', () => {
    expect(toBody(valid({ line: '  12 MG Road ', city: ' Hyderabad ' }))).toEqual({
      line: '12 MG Road',
      city: 'Hyderabad',
      pincode: '500001',
    });
  });

  it('sends the phone as E.164 and keeps the landmark', () => {
    expect(toBody(valid({ landmark: ' Metro ', contactPhone: '9876543210' }))).toMatchObject({
      landmark: 'Metro',
      contactPhone: '+919876543210',
    });
  });
});

describe('digitsOnly', () => {
  it('keeps digits up to the limit', () => {
    expect(digitsOnly('50 00-01x9', 6)).toBe('500001');
  });
});

describe('formatPartsAddress', () => {
  const address = (over: Partial<PartsAddress> = {}): PartsAddress => ({
    line: '12 MG Road',
    city: 'Hyderabad',
    pincode: '500001',
    landmark: null,
    contactPhone: null,
    setAt: '2026-10-30T05:30:00Z',
    ...over,
  });

  it('joins line, city and pincode', () => {
    expect(formatPartsAddress(address())).toBe('12 MG Road, Hyderabad 500001');
  });

  it('puts the landmark after the line', () => {
    expect(formatPartsAddress(address({ landmark: 'Metro' }))).toBe(
      '12 MG Road, near Metro, Hyderabad 500001',
    );
  });

  it('ignores a blank landmark', () => {
    expect(formatPartsAddress(address({ landmark: '  ' }))).toBe('12 MG Road, Hyderabad 500001');
  });
});
