import * as Notifications from 'expo-notifications';
import { useCallback } from 'react';
import { Linking } from 'react-native';

import { authedRequest } from '@/lib/api';
import { usePushPrefs } from '@/store/pushPrefs.store';

/**
 * The Profile switch, made to mean something.
 *
 * It was `useState(true)` — decorative, reset on every launch, connected to
 * nothing. Harmless while push did not exist; a lie once it did, because a
 * technician who turned it off would still have been pushed.
 *
 * Turning it OFF deletes the device's token server-side, so there is nowhere
 * left to send. Turning it back ON lets `usePushRegistration` register a fresh
 * one — an Expo token rotates anyway, so re-registering is the only correct way
 * back, not an optimisation.
 *
 * ## The OS has the final say, and the switch must not pretend otherwise
 *
 * If notification permission was denied at the system level, no amount of
 * toggling here delivers anything. So turning it on checks, and when the OS has
 * stopped asking, sends the technician to Settings rather than flipping a
 * switch that would silently do nothing.
 */
export function usePushToggle(): {
  enabled: boolean;
  toggle: () => void;
} {
  const enabled = usePushPrefs((s) => s.enabled);
  const hydrated = usePushPrefs((s) => s.hydrated);
  const token = usePushPrefs((s) => s.token);
  const setEnabled = usePushPrefs((s) => s.setEnabled);
  const setToken = usePushPrefs((s) => s.setToken);

  const toggle = useCallback(() => {
    if (enabled) {
      // The switch moves immediately — a technician turning notifications off
      // on a train must not watch a spinner. But the TOKEN is kept until the
      // server confirms it is gone.
      //
      // Discarding it here was a real hole: nothing expires a `push_tokens`
      // row — `last_seen_at` is written and never read — so a delete that
      // failed left the server pushing forever to a phone whose switch said
      // off, and with the token forgotten there was nothing left to retry
      // with. `usePushRegistration` now retries on the next launch.
      setEnabled(false);
      if (token) {
        void authedRequest('/notifications/devices', {
          method: 'DELETE',
          body: { token, platform: 'android' },
        })
          .then(() => setToken(null))
          .catch(() => {
            // Keep the token. Off + a stored token is the retry signal.
          });
      }
      return;
    }

    void (async () => {
      const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
      if (!granted) {
        const asked = canAskAgain
          ? (await Notifications.requestPermissionsAsync()).granted
          : false;
        if (!asked) {
          // The OS will not ask again, so the only route back is Settings.
          // Flipping the switch here would show "on" over a phone that
          // delivers nothing.
          if (!canAskAgain) void Linking.openSettings();
          return;
        }
      }
      // `usePushRegistration` watches this and registers a fresh token.
      setEnabled(true);
    })();
  }, [enabled, token, setEnabled, setToken]);

  // Show the DEFAULT until storage answers, never a stored value we have
  // not read yet — the switch must not flip under the technician.
  return { enabled: hydrated ? enabled : true, toggle };
}
