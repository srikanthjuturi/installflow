import { useLocalSearchParams } from 'expo-router';

import { RescheduleJobScreen } from '@/features/jobs/screens/RescheduleJobScreen';

/** Move the slot, with a code the CUSTOMER supplies. Net-new; not in the prototype. */
export default function RescheduleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <RescheduleJobScreen jobId={id} />;
}
