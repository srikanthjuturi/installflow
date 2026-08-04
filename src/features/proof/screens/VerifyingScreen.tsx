import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useJob } from '@/features/jobs/hooks/useJobs';
import { useSubmitProof, useVerification } from '@/features/proof/hooks/useVerification';
import { color } from '@/theme/semantic';
import { layout } from '@/theme/spacing';

export interface VerifyingScreenProps {
  jobId: string;
}

/**
 * Submits the captures, then polls until the AI run resolves.
 *
 * Held as its own screen rather than a spinner over Review because the wait is
 * genuinely open-ended and the technician is standing in a customer's home —
 * they need to see that something is happening and what it's checking.
 */
export function VerifyingScreen({ jobId }: VerifyingScreenProps) {
  const router = useRouter();
  const { data: job } = useJob(jobId);

  const submit = useSubmitProof(jobId);
  const verificationId = submit.data?.verificationId;

  const { data: verification } = useVerification(verificationId, jobId, job?.model ?? '');

  // Fires once — submit.mutate is stable and the guard stops a re-submit if the
  // job query resolves later and re-renders.
  useEffect(() => {
    if (submit.isIdle) submit.mutate();
  }, [submit]);

  useEffect(() => {
    if (verification && verification.status !== 'pending') {
      router.replace(`/job/${jobId}/proof/result?status=${verification.status}`);
    }
  }, [verification, jobId, router]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.cameraBg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: layout.screenGutter,
      }}
    >
      <ActivityIndicator size="large" color={color.actionBg} />

      <Text
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: 22,
          color: color.textInverse,
          marginTop: 26,
        }}
      >
        Verifying with AI
      </Text>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 14,
          lineHeight: 21,
          color: color.textMuted,
          textAlign: 'center',
          marginTop: 8,
        }}
      >
        Matching serial and product images against{'\n'}
        <Text style={{ fontFamily: 'Roboto_500Medium', color: color.textInverse }}>
          {job?.model ?? 'the order'}
        </Text>
        .
      </Text>
    </View>
  );
}
