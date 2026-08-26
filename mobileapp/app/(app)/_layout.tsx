import { Redirect, Stack } from 'expo-router';

import { usePoolStream } from '@/features/jobs/hooks/usePoolStream';
import { usePushRegistration } from '@/features/notifications/hooks/usePushRegistration';
import { useSessionStatus } from '@/store/session.store';

/**
 * Authenticated area — the guard the TODO here used to promise.
 *
 * Every screen under `(app)` assumes a signed-in technician: the tabs read
 * their own profile, proof capture posts against their jobs. Without this,
 * typing a route reached all of it with no session at all.
 *
 * accept-slot is a transparentModal so the sheet can animate up over the offer
 * screen with its own scrim, which a standard modal presentation can't do.
 */
export default function AppLayout() {
  const status = useSessionStatus();

  // One live pool socket for the whole signed-in session. Here rather than in
  // a screen because Home and the Pool tab read the same query key — a socket
  // each would deliver the same news twice and reconnect on every tab switch.
  // Hooks cannot sit below the redirect, so it is written to do nothing until
  // there is a session to authenticate with.
  usePoolStream();

  // Register this device for push, once per signed-in session, and route a tap
  // to the job it names. Alongside the socket rather than inside a screen for
  // the same reason: it belongs to the session, not to a route. Does nothing
  // in Expo Go on Android — remote push left it in SDK 53.
  usePushRegistration();

  // 'loading' cannot happen here — the root layout holds the splash until the
  // session has rehydrated — but treating it as signed-out would flash the
  // login screen if that ever changed.
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="accept-slot"
        options={{ presentation: 'transparentModal', animation: 'fade' }}
      />
    </Stack>
  );
}
