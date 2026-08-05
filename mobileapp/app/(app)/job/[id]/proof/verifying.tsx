import { useLocalSearchParams } from 'expo-router';

import { VerifyingScreen } from '@/features/proof/screens/VerifyingScreen';

/** Submits captures, then polls the AI run until it resolves. */
export default function VerifyingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <VerifyingScreen jobId={id} />;
}
