import { useIsFocused } from '@react-navigation/native';
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

  /**
   * Only redirect while this really is the screen in front of the technician.
   *
   * `unstable_settings.initialRouteName` in the root layout pins `index` as the
   * stack's anchor, so opening `videocontech://invite/<token>` mounts this route
   * UNDERNEATH the invite screen. `<Redirect>` navigates on mount whether or not
   * it is focused — so without this guard the deep link would land correctly and
   * then be thrown to the login screen a frame later, which reads as a broken
   * invite link and is close to undebuggable from a technician's description.
   *
   * The anchor is still required: dropping it is what made the app open on the
   * photo picker instead of sign-in.
   */
  const isFocused = useIsFocused();
  if (!isFocused) return null;

  if (status === 'authenticated') return <Redirect href="/(app)/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
