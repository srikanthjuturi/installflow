import { useLocalSearchParams } from 'expo-router';

import { ReviewScreen } from '@/features/proof/screens/ReviewScreen';

/** Screen 13 — last chance to retake before AI verification. */
export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ReviewScreen jobId={id} />;
}
