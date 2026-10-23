import { isEmployee } from '../technicianType';

describe('isEmployee', () => {
  it('reads employee', () => {
    expect(isEmployee({ technicianType: 'employee' })).toBe(true);
  });

  it('reads everything else as freelancer — today\'s behaviour', () => {
    expect(isEmployee({ technicianType: 'freelancer' })).toBe(false);
    expect(isEmployee({ technicianType: 'contractor' })).toBe(false);
    // A word is a word; case is not a third value.
    expect(isEmployee({ technicianType: 'EMPLOYEE' })).toBe(false);
  });

  it('reads an absent field as freelancer', () => {
    // A session persisted before the API sent the field has no key.
    expect(isEmployee({})).toBe(false);
  });

  it('reads a missing session as freelancer (signed-out renders nothing anyway)', () => {
    expect(isEmployee(null)).toBe(false);
    expect(isEmployee(undefined)).toBe(false);
  });
});