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
  const token = usePushPrefs((s) => s.token);
  const setEnabled = usePushPrefs((s) => s.setEnabled);
  const setToken = usePushPrefs((s) => s.setToken);

  const toggle = useCallback(() => {
    if (enabled) {
      // Optimistic: the switch moves now. The delete is best-effort because a
      // technician turning notifications off on a train should not have it fail
      // — and the registration on the next launch is gated on this preference,
      // so the token stops being refreshed either way.
      setEnabled(false);
      const current = token;
      setToken(null);
      if (current) {
        void authedRequest('/notifications/devices', {
          method: 'DELETE',
          body: { token: current, platform: 'android' },
        }).catch(() => {
          // Swallowed on purpose. See above: the preference is what gates
          // registration, and a failed delete leaves a token that stops being
          // renewed rather than one that keeps being pushed to forever.
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

  return { enabled, toggle };
}
