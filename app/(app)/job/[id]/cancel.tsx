import { useLocalSearchParams } from 'expo-router';

import { CancelJobScreen } from '@/features/jobs/screens/CancelJobScreen';

/** Screen 8 — cancel with a banded penalty. */
export default function CancelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <CancelJobScreen jobId={id} />;
}
