import { Redirect } from 'expo-router';

import { useSessionStatus } from '@/store/session.store';

/**
 * Boot route.
 *
 * A cold, signed-out app goes to LOGIN, not to the invite screen. That single
 * choice is what makes direct onboarding work: a technician a manager created
 * outright just signs in, and the invite screen becomes reachable only from a
 * deep link — by construction, rather than by a conditional inside it.
 *
 * The splash is still up until the session has rehydrated, so `status` is never
 * 'loading' by the time this renders.
 */
export default function Index() {
  const status = useSessionStatus();

  if (status === 'authenticated') return <Redirect href="/(app)/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
