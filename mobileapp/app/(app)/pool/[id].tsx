import { useLocalSearchParams } from 'expo-router';

import { OfferScreen } from '@/features/jobs/screens/OfferScreen';

/** Screen 5 — masked offer. Customer identity stays hidden until acceptance. */
export default function OfferRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <OfferScreen jobId={id} />;
}
