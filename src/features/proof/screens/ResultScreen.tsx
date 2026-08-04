import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card, DetailRow } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useCaptureStore } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { VerificationOutcome } from '@/types/domain';

export interface ResultScreenProps {
  jobId: string;
  status: VerificationOutcome;
}

/**
 * Screen 14 — AI verification result.
 *
 * Three genuinely different endings, not one screen with a colour swap:
 *   match      → carry on to closure
 *   mismatch   → out of the technician's hands, routed to the ASM
 *   unreadable → fixable right now, but only while still on site
 *
 * The unreadable copy is the one that earns its keep. Catching a blurry serial
 * before the technician drives away is the difference between a 20-second
 * retake and a second visit.
 */
export function ResultScreen({ jobId, status }: ResultScreenProps) {
  const router = useRouter();
  const { data: job } = useJob(jobId);
  const { setStep, clearStep } = useCaptureStore();

  const retakeSerial = () => {
    clearStep('serial');
    setStep('serial');
    router.replace(`/job/${jobId}/proof/capture`);
  };

  if (status === 'unreadable') {
    return (
      <ResultShell
        icon="warn"
        tone="warn"
        title="Image unreadable"
        body="The serial photo is blurry. Retake before you leave the site."
        footer={<Button label="Retake serial photo" onPress={retakeSerial} />}
      >
        <Card style={{ marginTop: 16 }}>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
            }}
          >
            Steady the camera, avoid glare on the sticker, and fill the frame with the serial
            label.
          </Text>
        </Card>
      </ResultShell>
    );
  }

  if (status === 'mismatch') {
    return (
      <ResultShell
        icon="warn"
        tone="danger"
        title="Mismatch flagged"
        body="Serial doesn't match the order. Routed to the Area Service Manager."
        footer={
          <Button label="Back to jobs" onPress={() => router.replace('/(app)/(tabs)/jobs')} />
        }
      >
        <Card style={{ marginTop: 16 }}>
          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 11,
              letterSpacing: 1.2,
              color: color.textMuted,
              marginBottom: 8,
            }}
          >
            WHAT HAPPENS NOW
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
            }}
          >
            The ASM reviews your captures and the mismatch. You&apos;ll be notified once they
            approve or ask you to recapture.
          </Text>
        </Card>
      </ResultShell>
    );
  }

  return (
    <ResultShell
      icon="geo"
      tone="success"
      title="Verification passed"
      body="Serial and product match the order."
      footer={
        <Button
          label="Send feedback link to customer"
          onPress={() => router.replace(`/job/${jobId}/proof/closure`)}
        />
      }
    >
      <Card style={{ marginTop: 16 }}>
        <DetailRow label="Model matched" value={job?.model ?? '—'} first />
        <DetailRow label="Serial read" value="VCN-400067-8841" />
        <DetailRow label="Confidence" value="98%  ·  Auto-pass" />
      </Card>
    </ResultShell>
  );
}

interface ResultShellProps {
  icon: IconName;
  tone: 'success' | 'warn' | 'danger';
  title: string;
  body: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}

function ResultShell({ icon, tone, title, body, children, footer }: ResultShellProps) {
  const palette = {
    success: color.statusCompleted,
    warn: { fg: color.slotFg, bg: color.slotBg },
    danger: color.statusCancelled,
  }[tone];

  return (
    <>
      <Header showBack={false} />

      <Screen footer={footer}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: palette.bg,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          <Icon name={icon} size={30} color={palette.fg} />
        </View>

        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 25,
            lineHeight: 31,
            color: color.textPrimary,
            marginTop: 18,
            letterSpacing: -0.5,
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.textSecondary,
            marginTop: 6,
          }}
        >
          {body}
        </Text>

        {children}
      </Screen>
    </>
  );
}
