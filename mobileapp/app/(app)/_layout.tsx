import { Redirect, Stack } from 'expo-router';

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
