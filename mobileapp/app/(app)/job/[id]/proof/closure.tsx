import { useLocalSearchParams } from 'expo-router';

import { ClosureScreen } from '@/features/proof/screens/ClosureScreen';

/** Feedback link sent — the customer or the ASM closes the ticket, not us. */
export default function ClosureRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ClosureScreen jobId={id} />;
}
