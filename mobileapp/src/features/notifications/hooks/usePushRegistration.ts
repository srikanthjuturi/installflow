import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { authedRequest } from '@/lib/api';
import { usePushPrefs } from '@/store/pushPrefs.store';
import { useSessionStatus } from '@/store/session.store';

/**
 * How a notification behaves while the app is OPEN.
 *
 * Without this, expo-notifications shows nothing in the foreground — the
 * notification arrives, the listeners fire, and the technician sees no banner
 * at all. That is the correct default for a chat app whose UI already shows the
 * message; it is wrong here, where a job offer is worth interrupting whatever
 * screen somebody is on, and where the alternative is silence that looks
 * exactly like push being broken.
 *
 * Module scope on purpose: it must be set before the first notification can be
 * delivered, which can be before any component has mounted.
 *
 * No badge. A number on the app icon has to be cleared by something, and
 * nothing here owns "how many did you not deal with" — an offer resolves by
 * somebody else accepting it, not by being read.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Register this device for push, and route a tap to the job it is about.
 *
 * ## This does nothing in Expo Go on Android
 *
 * Remote push was removed from Expo Go in SDK 53 — `getExpoPushTokenAsync`
 * throws there rather than returning something unusable. That is caught and
 * logged rather than surfaced: a technician running a development build gets
 * notifications, one scanning a QR code does not, and neither should see an
 * error about it. Local notifications still work in both.
 *
 * ## Registration happens on every launch
 *
 * An Expo token is not permanent. It rotates, and a reinstall produces a new
 * one, so the app re-registers rather than trusting what it stored last time.
 * The server upserts on the token, so this is cheap and idempotent.
 */
export function usePushRegistration(): void {
  const status = useSessionStatus();
  const router = useRouter();
  const enabled = usePushPrefs((s) => s.enabled);
  const token = usePushPrefs((s) => s.token);
  const hydrated = usePushPrefs((s) => s.hydrated);
  const setToken = usePushPrefs((s) => s.setToken);
  const registered = useRef(false);

  // ── the token ────────────────────────────────────────────────────────────
  useEffect(() => {
    // Until SecureStore has answered, `enabled` is still its default `true`.
    // Acting on that would register a token for a technician who had switched
    // notifications OFF, and then delete it a moment later — every launch.
    if (!hydrated) return;
    // The switch is off on this device. Nothing is registered, so there is
    // nothing for the server to send to — see `pushPrefs.store` for why the
    // preference is per device rather than a column on the technician.
    if (!enabled) {
      registered.current = false;
      // Off, but the server was never told. The delete failed at the moment
      // the switch moved — no signal, a 500 — and nothing expires a
      // `push_tokens` row, so without this the technician keeps receiving
      // notifications they switched off, indefinitely. Retried every launch
      // until it sticks.
      if (token && status === 'authenticated') {
        void authedRequest('/notifications/devices', {
          method: 'DELETE',
          body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
        })
          .then(() => setToken(null))
          .catch(() => {
            // Still unreachable. Try again next launch.
          });
      }
      return;
    }
    if (status !== 'authenticated' || registered.current) return;
    // A ref, not state: registering must not re-run because it registered.
    registered.current = true;

    void (async () => {
      try {
        // An emulator has no push service to register with, and asking throws.
        if (!Device.isDevice) return;

        if (Platform.OS === 'android') {
          // Android 8+ drops any notification that names no channel. Created
          // BEFORE the token is requested, because the first notification can
          // arrive before this effect would otherwise get here.
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Job offers',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
          });
        }

        const existing = await Notifications.getPermissionsAsync();
        const granted =
          existing.granted ||
          (await Notifications.requestPermissionsAsync()).granted;
        // Declining is an answer, not a failure. Nothing is retried and nothing
        // is shown — the technician can turn it on in the OS if they change
        // their mind, and nagging is what makes people turn it off for good.
        if (!granted) return;

        // The project id is what ties a token to THIS Expo project. Without it
        // the call throws in a build that has no owner baked in.
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as
          | string
          | undefined;
        if (!projectId) return;

        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId,
        });

        await authedRequest('/notifications/devices', {
          method: 'POST',
          body: {
            token,
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            deviceName: Device.deviceName ?? undefined,
          },
        });
        // Kept so the switch can name this device when it is turned off — by
        // then there is no reason to have asked Expo for a token again.
        setToken(token);
      } catch (error) {
        // Expo Go on Android lands here every launch. Never surfaced: the app
        // works without push, and an error toast about a feature the
        // technician did not ask for is worse than silence.
        if (__DEV__) console.warn('Push registration skipped:', error);
        registered.current = false;
      }
    })();
  }, [status, enabled, token, hydrated, setToken]);

  // ── tapping one ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated') return;

    const open = (data: Record<string, unknown> | undefined) => {
      // Routing only — the frame carries no customer details, so the screen
      // this lands on fetches the offer through the authenticated API.
      if (data?.type === 'pool' && typeof data.ticketId === 'string') {
        router.push(`/pool/${data.ticketId}`);
      }
    };

    // A tap that COLD-STARTED the app is not delivered to the listener below —
    // it already happened. Without this the app opens on Home and the
    // notification appears to have done nothing.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data);
    });

    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, [status, router]);
}
