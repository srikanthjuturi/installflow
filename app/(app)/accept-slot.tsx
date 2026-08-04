import { useLocalSearchParams } from 'expo-router';

import { AcceptSlotSheet } from '@/features/jobs/screens/AcceptSlotSheet';

/** The consent gate before a technician is bound to a customer-confirmed slot. */
export default function AcceptSlotRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();

  return <AcceptSlotSheet jobId={jobId} />;
}
