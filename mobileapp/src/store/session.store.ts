import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { secureStorage } from '@/lib/secureStorage';
import type { TechnicianSession } from '@/types/domain';

/**
 * Who is signed in.
 *
 * Client state, so Zustand is right (hard rule 3) — the OTP call itself is a
 * TanStack mutation; only its RESULT lands here.
 *
 * `hydrated` exists because SecureStore is async. On the first frame `token` is
 * null whatever the truth is, so any redirect decided then sends a signed-in
 * technician back to the login screen. `app/_layout.tsx` holds the splash until
 * this flips, which is why there is no loading screen anywhere in the boot path.
 */
interface SessionState {
  hydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  technician: TechnicianSession | null;

  signIn: (payload: {
    accessToken: string;
    refreshToken: string;
    technician: TechnicianSession;
  }) => void;
  signOut: () => void;
  setTechnician: (technician: TechnicianSession) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      hydrated: false,
      accessToken: null,
      refreshToken: null,
      technician: null,

      signIn: ({ accessToken, refreshToken, technician }) =>
        set({ accessToken, refreshToken, technician }),

      signOut: () =>
        set({ accessToken: null, refreshToken: null, technician: null }),

      setTechnician: (technician) => set({ technician }),
    }),
    {
      name: 'videocon.session',
      version: 1,
      storage: createJSONStorage(() => secureStorage),
      // `hydrated` is derived, not stored — persisting it would boot the app
      // claiming to be hydrated before it had read anything.
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        technician: s.technician,
      }),
      onRehydrateStorage: () => (state, error) => {
        // Flip it either way: a read failure means "no session", and leaving it
        // false would hold the splash forever.
        if (error) console.warn('Session rehydration failed', error);
        useSession.setState({ hydrated: true });
        void state;
      },
    },
  ),
);

export type SessionStatus = 'loading' | 'signedOut' | 'authenticated';

export function useSessionStatus(): SessionStatus {
  const hydrated = useSession((s) => s.hydrated);
  const token = useSession((s) => s.accessToken);
  if (!hydrated) return 'loading';
  return token ? 'authenticated' : 'signedOut';
}

/** For non-React callers (the API layer). Never read the token from a closure. */
export const getAccessToken = () => useSession.getState().accessToken;
