import { useLocalSearchParams } from 'expo-router';

import { PartRequestScreen } from '@/features/parts/screens/PartRequestScreen';

/** Ask the parts store for a spare part on this job. */
export default function PartRequestRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <PartRequestScreen jobId={id} />;
}
