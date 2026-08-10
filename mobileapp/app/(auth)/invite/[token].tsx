import { useLocalSearchParams } from 'expo-router';

import { InviteScreen } from '@/features/onboarding/screens/InviteScreen';

/**
 * R1 — entered from the deep link `videocontech://invite/<token>`.
 *
 * The path-segment form the app scheme has always documented. `invite/index`
 * keeps the older `?token=` query form working.
 */
export default function InviteTokenRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <InviteScreen token={token} />;
}
