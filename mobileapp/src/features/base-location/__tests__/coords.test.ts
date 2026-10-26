import { INDIA, inIndia, round5 } from '@/features/base-location/lib/coords';

describe('inIndia', () => {
  it('includes both bounds on both axes', () => {
    expect(inIndia(INDIA.lat[0], INDIA.lng[0])).toBe(true);
    expect(inIndia(INDIA.lat[1], INDIA.lng[1])).toBe(true);
    expect(inIndia(INDIA.lat[0], INDIA.lng[1])).toBe(true);
    expect(inIndia(INDIA.lat[1], INDIA.lng[0])).toBe(true);
  });

  it('refuses just outside each bound', () => {
    expect(inIndia(5.9999, 80)).toBe(false);
    expect(inIndia(38.0001, 80)).toBe(false);
    expect(inIndia(20, 67.9999)).toBe(false);
    expect(inIndia(20, 98.0001)).toBe(false);
  });

  it('refuses a non-finite point', () => {
    expect(inIndia(NaN, 80)).toBe(false);
    expect(inIndia(20, Infinity)).toBe(false);
  });

  it('accepts a point in Hyderabad', () => {
    expect(inIndia(17.385, 78.4867)).toBe(true);
  });
});

describe('round5', () => {
  it('rounds to five decimal places', () => {
    expect(round5(17.4401234)).toBe(17.44012);
  });

  it('rounds symmetrically for negatives', () => {
    expect(round5(-17.4401234)).toBe(-17.44012);
    expect(round5(-17.440129)).toBe(-round5(17.440129));
  });
});
