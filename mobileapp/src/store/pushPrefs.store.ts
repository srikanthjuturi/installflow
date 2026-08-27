import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { secureStorage } from '@/lib/secureStorage';

interface PushPrefsState {
  /** Whether this technician wants notifications ON THIS DEVICE. */
  enabled: boolean;
  /** The Expo token currently registered, so it can be unregistered. */
  token: string | null;
  /**
   * Whether SecureStore has been read yet. Same reason `session.store` has one:
   * the read is async, so on the first frame `enabled` is still the default
   * `true`. Registering on that would hand the server a token belonging to a
   * technician who had switched notifications OFF — then delete it a moment
   * later, on every single launch.
   */
  hydrated: boolean;
  setEnabled: (enabled: boolean) => void;
  setToken: (token: string | null) => void;
}

/**
 * Whether to push to THIS phone.
 *
 * Per device, not per technician, and deliberately: somebody carrying a work
 * phone and a personal one wants offers on one of them. A flag on the server's
 * technician row could not express that — it would turn both on or both off —
 * which is why this is client state and lives here rather than in a column.
 *
 * Persisted because it is a decision, not a symptom. `usePushRegistration`
 * registers on every launch, so without this a technician who switched
 * notifications off would have them switched back on by the next cold start,
 * and would have no way to tell that had happened.
 *
 * The token is kept alongside it for one reason: turning the switch OFF has to
 * name the device being removed, and by then the app has no reason to have
 * asked Expo for a token.
 *
 * SecureStore rather than plain storage, matching the session and registration
 * stores — a push token is not a credential, but it identifies a device and
 * there is no second storage mechanism in this app worth introducing for it.
 */
export const usePushPrefs = create<PushPrefsState>()(
  persist(
    (set) => ({
      // On by default. A technician who installed a field-work app has opted
      // into being told about work; the OS permission prompt is the real
      // consent gate, and this switch is how they change their mind later.
      enabled: true,
      token: null,
      hydrated: false,
      setEnabled: (enabled) => set({ enabled }),
      setToken: (token) => set({ token }),
    }),
    {
      name: 'reliancegreentech.push',
      version: 1,
      storage: createJSONStorage(() => secureStorage),
      // `hydrated` is derived, not stored — persisting it would boot the app
      // claiming to have read storage before it had.
      partialize: (s) => ({ enabled: s.enabled, token: s.token }),
    },
  ),
);

/**
 * Flip `hydrated` once storage has been read.
 *
 * Wired from OUT here rather than inside `create()`, for the reason
 * `session.store` spells out: referencing the store inside its own config is a
 * temporal-dead-zone trap, and the resulting rejection is swallowed.
 */
function markHydrated() {
  if (!usePushPrefs.getState().hydrated) {
    usePushPrefs.setState({ hydrated: true });
  }
}

usePushPrefs.persist.onFinishHydration(markHydrated);
// Covers the race where rehydration already finished before this line ran.
if (usePushPrefs.persist.hasHydrated()) markHydrated();

/**
 * Failsafe. A hung Keychain read must not leave push permanently unregistered
 * with nothing to show why — the defaults are the right answer for a fresh
 * install, which is the case this would otherwise strand.
 */
const HYDRATION_TIMEOUT_MS = 3000;
setTimeout(() => {
  if (!usePushPrefs.getState().hydrated) {
    console.warn(
      `[push] storage did not respond in ${HYDRATION_TIMEOUT_MS}ms — using defaults`,
    );
    markHydrated();
  }
}, HYDRATION_TIMEOUT_MS);
