import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useCaptureStore } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface ClosureScreenProps {
  jobId: string;
}

/**
 * Derived from the ticket, not hardcoded.
 *
 * These three used to be a literal array with two ticks and an empty ring, no
 * matter what had actually happened — including when the WhatsApp send had
 * failed outright. Now the second step reads the ticket's own record of the
 * send, so a technician can see that the customer was NOT reached and tell them
 * in person before leaving.
 */
function steps(delivered: boolean): { label: string; done: boolean }[] {
  return [
    { label: 'Proof captured & uploaded', done: true },
    {
      label: delivered ? 'Confirmation link delivered' : 'Confirmation link not delivered',
      done: delivered,
    },
    { label: 'Awaiting customer confirmation', done: false },
  ];
}

/**
 * Closure.
 *
 * Deliberately does NOT claim the ticket is closed. The customer closes it by
 * responding, or the ASM force-closes it later with supporting documents. The
 * third step stays an empty ring for exactly that reason — the technician's
 * part is finished, the ticket's is not, and the screen has to show both.
 */
export function ClosureScreen({ jobId }: ClosureScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: job } = useJob(jobId);
  const reset = useCaptureStore((s) => s.reset);

  // Nothing is sent from here. `POST /jobs/:id/complete` — which the Job detail
  // button already called to reach this screen — mints the token and sends the
  // WhatsApp in the same request that moved the ticket. Sending again here
  // would be a second message for one finished job.
  const delivered = job?.serverStatus === 'Awaiting Customer';

  // The captures are on the server now; the local copies are just cache.
  useEffect(() => reset, [reset]);

  const done = () => router.replace('/(app)/(tabs)/jobs');

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <View
          style={{
            backgroundColor: color.chrome,
            alignItems: 'center',
            paddingTop: insets.top + 46,
            paddingHorizontal: 26,
            paddingBottom: 30,
          }}
        >
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              backgroundColor: color.heroWellBlue,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <Icon name="mapCheck" size={42} color={color.verifyAccent} />
          </Animated.View>

          <Text
            style={{ fontFamily: 'Roboto_900Black', fontSize: 22, color: color.textInverse }}
          >
            Feedback link sent
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 14,
              lineHeight: 21,
              color: color.textOnChrome,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            {job?.customer ?? 'The customer'} received a WhatsApp link to confirm &amp; rate the
            install.
          </Text>
        </View>

        <View style={{ paddingVertical: 18, paddingHorizontal: 16 }}>
          <View
            style={{
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              paddingVertical: 4,
            }}
          >
            {steps(delivered).map((step, i) => (
              <View
                key={step.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: palette.neutral[100],
                }}
              >
                {step.done ? (
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: color.online,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="check" size={15} color={color.textInverse} />
                  </View>
                ) : (
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      borderWidth: 2,
                      borderColor: color.stepPending,
                    }}
                  />
                )}

                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 14,
                    color: step.done ? color.textPrimary : color.textSecondary,
                  }}
                >
                  {step.label}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12.5,
              lineHeight: 19,
              color: color.textFootnote,
              marginTop: 16,
              marginHorizontal: 4,
            }}
          >
            If the customer doesn&apos;t respond in the set window, the ASM can force-close with
            supporting documents. Every closure records who, when and why.
          </Text>

          <View style={{ marginTop: 22 }}>
            <Button label="Done · back to jobs" onPress={done} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
