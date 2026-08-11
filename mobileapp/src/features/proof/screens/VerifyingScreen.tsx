import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icons/Icon';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useSubmitProof, useVerification } from '@/features/proof/hooks/useVerification';
import { color } from '@/theme/semantic';

export interface VerifyingScreenProps {
  jobId: string;
}

/**
 * Submits the captures, then polls until the AI run resolves.
 *
 * Its own screen rather than a spinner over Review, because the wait is
 * genuinely open-ended and the technician is standing in a customer's home —
 * they need to see that something is happening and what is being checked.
 */
export function VerifyingScreen({ jobId }: VerifyingScreenProps) {
  const router = useRouter();
  const { data: job } = useJob(jobId);

  const submit = useSubmitProof(jobId);
  const verificationId = submit.data?.verificationId;

  const { data: verification } = useVerification(verificationId, jobId, job?.model ?? '');

  useEffect(() => {
    if (submit.isIdle) submit.mutate();
  }, [submit]);

  useEffect(() => {
    if (verification && verification.status !== 'pending') {
      // The id travels with the outcome so the result screen can render what
      // the run actually read, rather than inventing a serial from the pincode.
      router.replace(
        `/job/${jobId}/proof/result?status=${verification.status}` +
          `&verificationId=${encodeURIComponent(verification.id)}`,
      );
    }
  }, [verification, jobId, router]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.chrome,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
        paddingHorizontal: 34,
      }}
    >
      <StatusBar style="light" />

      <VerifyingIndicator />

      <Text
        style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textInverse }}
      >
        Verifying with AI
      </Text>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 14,
          lineHeight: 21,
          color: color.textOnChrome,
          textAlign: 'center',
          marginTop: 8,
          maxWidth: 250,
        }}
      >
        Matching serial and product images against{' '}
        <Text style={{ fontFamily: 'Roboto_700Bold', color: color.verifyStrongText }}>
          {job?.model ?? 'the order'}
        </Text>
        .
      </Text>
    </View>
  );
}

/**
 * Three layers: an expanding pulse, a rotating partial ring, and a static
 * sparkle. The pulse is what makes an open-ended wait feel alive rather than
 * stalled — a bare spinner on a dark screen reads as "frozen" after a few
 * seconds, which is exactly when a technician starts tapping things.
 */
function VerifyingIndicator() {
  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.ease) }), -1, false);
    spin.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1, false);
  }, [pulse, spin]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.7 + pulse.value * 0.45 }],
    opacity: 1 - pulse.value,
  }));

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View
      style={{
        width: 132,
        height: 132,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 34,
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 132,
            height: 132,
            borderRadius: 66,
            backgroundColor: color.verifyPulse,
          },
          pulseStyle,
        ]}
      />

      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 104,
            height: 104,
            borderRadius: 52,
            borderWidth: 3,
            borderColor: color.verifyTrack,
            borderTopColor: color.verifyAccent,
          },
          spinStyle,
        ]}
      />

      <Icon name="sparkle" size={46} color={color.verifyAccent} />
    </View>
  );
}
