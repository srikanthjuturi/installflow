import { useLocalSearchParams } from 'expo-router';

import { JobDetailScreen } from '@/features/jobs/screens/JobDetailScreen';

/** Screen 7 — unlocked detail. Customer identity is visible once assigned. */
export default function JobDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <JobDetailScreen jobId={id} />;
}
