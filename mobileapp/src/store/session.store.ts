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
  /**
   * Both tokens, after a refresh. The server ROTATES the refresh token and
   * revokes the one presented, so storing only the new access token would
   * leave a dead refresh token behind and log the technician out at the next
   * expiry.
   */
  setTokens: (payload: { accessToken: string; refreshToken: string }) => void;
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

      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
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
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[session] rehydration failed', error);
      },
    },
  ),
);

/**
 * Flip `hydrated` once storage has been read — wired from OUT here, not from
 * inside the `create()` call above.
 *
 * Referencing `useSession` inside its own config is a temporal-dead-zone trap:
 * if rehydration settles before this module finishes evaluating, the callback
 * throws inside a promise, the rejection is swallowed, `hydrated` never becomes
 * true, and the splash screen stays up forever with no error anywhere. The app
 * looks frozen and nothing explains why.
 */
function markHydrated() {
  if (!useSession.getState().hydrated) {
    useSession.setState({ hydrated: true });
  }
}

useSession.persist.onFinishHydration(markHydrated);
// Covers the race where rehydration already finished before this line ran.
if (useSession.persist.hasHydrated()) markHydrated();

/**
 * Failsafe. If the Keychain read hangs — a locked device, a corrupt entry, a
 * platform quirk — the app must still start. Signed-out is the safe assumption:
 * the worst case is one unnecessary sign-in, against an app that never opens.
 */
const HYDRATION_TIMEOUT_MS = 3000;
setTimeout(() => {
  if (!useSession.getState().hydrated) {
    console.warn(
      `[session] storage did not respond in ${HYDRATION_TIMEOUT_MS}ms — starting signed out`,
    );
    markHydrated();
  }
}, HYDRATION_TIMEOUT_MS);

export type SessionStatus = 'loading' | 'signedOut' | 'authenticated';

export function useSessionStatus(): SessionStatus {
  const hydrated = useSession((s) => s.hydrated);
  const token = useSession((s) => s.accessToken);
  if (!hydrated) return 'loading';
  return token ? 'authenticated' : 'signedOut';
}

/** For non-React callers (the API layer). Never read the token from a closure. */
export const getAccessToken = () => useSession.getState().accessToken;
export const getRefreshToken = () => useSession.getState().refreshToken;
