import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useSendFeedbackLink } from '@/features/proof/hooks/useVerification';
import { useCaptureStore } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface ClosureScreenProps {
  jobId: string;
}

const STEPS = [
  { label: 'Proof captured & AI-verified', done: true },
  { label: 'Feedback link delivered', done: true },
  { label: 'Awaiting customer confirmation', done: false },
];

/**
 * Closure.
 *
 * Deliberately does NOT claim the ticket is closed. The customer closes it by
 * responding, or the ASM force-closes it later with supporting documents —
 * either way it's out of the technician's hands, and the copy says so rather
 * than implying the job is finished when it isn't.
 */
export function ClosureScreen({ jobId }: ClosureScreenProps) {
  const router = useRouter();
  const { data: job } = useJob(jobId);
  const send = useSendFeedbackLink(jobId);
  const reset = useCaptureStore((s) => s.reset);

  useEffect(() => {
    if (send.isIdle) send.mutate();
  }, [send]);

  const done = () => {
    reset();
    router.replace('/(app)/(tabs)/jobs');
  };

  return (
    <>
      <Header showBack={false} />

      <Screen footer={<Button label="Done — back to jobs" onPress={done} />}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: color.statusCompleted.bg,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          <Icon name="bell" size={30} color={color.statusCompleted.fg} />
        </View>

        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 25,
            color: color.textPrimary,
            marginTop: 18,
            letterSpacing: -0.5,
          }}
        >
          Feedback link sent
        </Text>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.textSecondary,
            marginTop: 6,
            marginBottom: 20,
          }}
        >
          {job?.customer ?? 'The customer'} received a WhatsApp link to confirm &amp; rate the
          install.
        </Text>

        <Card>
          {STEPS.map((step, i) => (
            <View
              key={step.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 12,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: color.border,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: radius.full,
                  backgroundColor: step.done ? color.statusCompleted.bg : color.surfaceSunken,
                  borderWidth: step.done ? 0 : 1,
                  borderColor: color.borderStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {step.done ? (
                  <Text
                    style={{
                      fontFamily: 'Roboto_900Black',
                      fontSize: 12,
                      color: color.statusCompleted.fg,
                    }}
                  >
                    ✓
                  </Text>
                ) : null}
              </View>

              <Text
                style={{
                  fontFamily: step.done ? 'Roboto_500Medium' : 'Roboto_400Regular',
                  fontSize: 13.5,
                  color: step.done ? color.textPrimary : color.textSecondary,
                }}
              >
                {step.label}
              </Text>
            </View>
          ))}
        </Card>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            lineHeight: 19,
            color: color.textMuted,
            marginTop: 16,
          }}
        >
          If the customer doesn&apos;t respond in the set window, the ASM can force-close with
          supporting documents. Every closure records who, when and why.
        </Text>
      </Screen>
    </>
  );
}
