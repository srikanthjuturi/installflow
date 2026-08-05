import { useLocalSearchParams } from 'expo-router';

import { InviteScreen } from '@/features/onboarding/screens/InviteScreen';

/** R1 — entered via the deep link `videocontech://invite/<token>`. */
export default function InviteRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();

  return <InviteScreen token={token ?? 'demo-invite-token'} />;
}
