import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { InviteDetails } from '@/features/onboarding/api/invite';
import { secureStorage } from '@/lib/secureStorage';

/**
 * A registration in progress.
 *
 * Persisted under its own key, separate from the session: signing out must not
 * wipe a half-finished registration, and finishing one must not leave a draft
 * behind. Persisted at all because a technician standing in a shop with one bar
 * of signal will background this app mid-flow, and losing their categories to
 * that is the difference between onboarding and giving up.
 *
 * Nothing here reaches the server until the OTP is verified — see
 * `submitRegistration`.
 */

export const REGISTRATION_STEPS = ['invite', 'profile', 'coverage', 'verify'] as const;
export type RegistrationStep = (typeof REGISTRATION_STEPS)[number];

/** Total for `StepDots`, so no screen carries a hardcoded number. */
export const REGISTRATION_STEP_COUNT = REGISTRATION_STEPS.length;

export const stepNumber = (step: RegistrationStep) =>
  REGISTRATION_STEPS.indexOf(step) + 1;

export interface RegistrationDraft {
  token: string;
  invite: InviteDetails;
  fullName: string;
  /** A local file uri from the crop screen; uploaded material comes later. */
  photoUri: string | null;
  subcategoryIds: string[];
  pincodes: string[];
  /** Set once the OTP is verified; the register call needs it. */
  registrationToken: string | null;
}

interface RegistrationState {
  draft: RegistrationDraft | null;
  start: (token: string, invite: InviteDetails) => void;
  setProfile: (fullName: string, photoUri: string | null) => void;
  setCoverage: (subcategoryIds: string[], pincodes: string[]) => void;
  setRegistrationToken: (token: string) => void;
  clear: () => void;
}

export const useRegistration = create<RegistrationState>()(
  persist(
    (set) => ({
      draft: null,

      start: (token, invite) =>
        set((s) =>
          // Re-opening the SAME link keeps whatever they already typed; a
          // different link is a different person and starts clean.
          s.draft?.token === token
            ? { draft: { ...s.draft, invite } }
            : {
                draft: {
                  token,
                  invite,
                  fullName: '',
                  photoUri: null,
                  subcategoryIds: [],
                  pincodes: [],
                  registrationToken: null,
                },
              },
        ),

      setProfile: (fullName, photoUri) =>
        set((s) => (s.draft ? { draft: { ...s.draft, fullName, photoUri } } : s)),

      setCoverage: (subcategoryIds, pincodes) =>
        set((s) =>
          s.draft ? { draft: { ...s.draft, subcategoryIds, pincodes } } : s,
        ),

      setRegistrationToken: (registrationToken) =>
        set((s) => (s.draft ? { draft: { ...s.draft, registrationToken } } : s)),

      clear: () => set({ draft: null }),
    }),
    {
      name: 'videocon.registration',
      version: 1,
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
