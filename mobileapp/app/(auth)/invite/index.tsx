import { Redirect, useLocalSearchParams } from 'expo-router';

import { InviteScreen } from '@/features/onboarding/screens/InviteScreen';

/**
 * `reliancegreentech://invite?token=…` — the query form.
 *
 * Kept so links already sent keep working. With no token at all there is
 * nothing to resolve, so this falls through to sign-in rather than rendering an
 * error for a screen the technician never asked for.
 */
export default function InviteQueryRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  if (!token) return <Redirect href="/(auth)/login" />;
  return <InviteScreen token={token} />;
}
