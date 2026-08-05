import { Stack } from 'expo-router';

/**
 * Authenticated area. The auth guard lands here once the session store exists.
 *
 * accept-slot is a transparentModal so the sheet can animate up over the offer
 * screen with its own scrim, which a standard modal presentation can't do.
 */
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="accept-slot"
        options={{ presentation: 'transparentModal', animation: 'fade' }}
      />
      <Stack.Screen
        name="avatar-options"
        options={{ presentation: 'transparentModal', animation: 'fade' }}
      />
    </Stack>
  );
}
