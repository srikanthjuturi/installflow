import { REGISTRATION_STEP_COUNT, stepNumber } from '@/store/registration.store';

jest.mock('@/lib/secureStorage', () => ({
  secureStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

describe('registration steps', () => {
  it('has five steps, so every StepDots reads N of 5', () => {
    expect(REGISTRATION_STEP_COUNT).toBe(5);
  });

  it('puts the base location after verifying the number', () => {
    expect(stepNumber('verify')).toBe(4);
    expect(stepNumber('base')).toBe(5);
  });
});
