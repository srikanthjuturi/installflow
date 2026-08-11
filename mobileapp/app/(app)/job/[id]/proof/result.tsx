import { useLocalSearchParams } from 'expo-router';

import { ResultScreen } from '@/features/proof/screens/ResultScreen';
import type { VerificationOutcome } from '@/types/domain';

/** Screen 14 — match, mismatch or unreadable. */
export default function ResultRoute() {
  const { id, status, verificationId } = useLocalSearchParams<{
    id: string;
    status?: string;
    verificationId?: string;
  }>();

  return (
    <ResultScreen
      jobId={id}
      status={(status as VerificationOutcome) ?? 'match'}
      verificationId={verificationId}
    />
  );
}
