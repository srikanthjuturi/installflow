import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { secureStorage } from '@/lib/secureStorage';

interface PushPrefsState {
  /** Whether this technician wants notifications ON THIS DEVICE. */
  enabled: boolean;
  /** The Expo token currently registered, so it can be unregistered. */
  token: string | null;
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
      setEnabled: (enabled) => set({ enabled }),
      setToken: (token) => set({ token }),
    }),
    {
      name: 'reliancegreentech.push',
      version: 1,
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
