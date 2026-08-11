import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import type { Verification } from '@/features/proof/api/verification';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useCaptureStore } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { VerificationOutcome } from '@/types/domain';

export interface ResultScreenProps {
  jobId: string;
  status: VerificationOutcome;
  /** Which run produced this outcome — carries the serial and confidence. */
  verificationId?: string;
}

/**
 * Screen 14 — AI verification result.
 *
 * Three genuinely different endings, each with its own full-bleed gradient
 * hero rather than one layout recoloured:
 *   match      → carry on to closure
 *   mismatch   → out of the technician's hands, routed to the ASM
 *   unreadable → fixable right now, but only while still on site
 *
 * The unreadable branch is the one that earns its keep. Catching a blurry
 * serial before the technician drives away is the difference between a
 * 20-second retake and a second visit.
 */
export function ResultScreen({ jobId, status, verificationId }: ResultScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: job } = useJob(jobId);
  const { setStep, clearStep } = useCaptureStore();

  // What the run actually read, from the cache the verifying screen filled a
  // moment ago. A read rather than a query because the result is terminal —
  // there is nothing left to poll. If the app was reloaded straight onto this
  // route the cache is empty and the rows render as dashes, which is the
  // honest answer: this device no longer knows what the serial was.
  const verification = useQueryClient().getQueryData<Verification>([
    'verifications',
    verificationId,
  ]);

  const retakeSerial = () => {
    clearStep('serial');
    setStep('serial');
    router.replace(`/job/${jobId}/proof/capture`);
  };

  if (status === 'mismatch') {
    return (
      <Shell
        gradient={color.dangerHero}
        icon="warn"
        iconSize={46}
        title="Mismatch flagged"
        body="Serial doesn't match the order. Routed to the Area Service Manager."
        bodyColor={color.dangerHeroText}
        insets={insets}
      >
        <View
          style={{
            backgroundColor: color.surfaceRaised,
            borderWidth: 1,
            borderColor: color.dangerSurfaceBorder,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 11,
              letterSpacing: 0.88,
              textTransform: 'uppercase',
              color: color.debit,
              marginBottom: 8,
            }}
          >
            What happens now
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 21,
              color: color.textLabel,
            }}
          >
            The ASM reviews your captures and the mismatch. You&apos;ll be notified once they
            approve or ask you to recapture.
          </Text>
        </View>

        <View style={{ marginTop: 16 }}>
          <Button
            label="Back to jobs"
            variant="secondary"
            onPress={() => router.replace('/(app)/(tabs)/jobs')}
          />
        </View>
      </Shell>
    );
  }

  if (status === 'unreadable') {
    return (
      <Shell
        gradient={color.warnHero}
        icon="cameraOff"
        iconSize={46}
        title="Image unreadable"
        body="The serial photo is blurry. Retake before you leave the site."
        bodyColor={color.warnHeroText}
        insets={insets}
      >
        <View
          style={{
            backgroundColor: color.slotBlockBg,
            borderWidth: 1,
            borderColor: color.slotBlockBorder,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 21,
              color: color.slotFg,
            }}
          >
            Steady the camera, avoid glare on the sticker, and fill the frame with the serial
            label.
          </Text>
        </View>

        <View style={{ marginTop: 16 }}>
          <Button label="Retake serial photo" leadingIcon="camera" onPress={retakeSerial} />
        </View>
      </Shell>
    );
  }

  return (
    <Shell
      gradient={color.successHero}
      icon="check"
      iconSize={48}
      title="Verification passed"
      body="Serial and product match the order."
      bodyColor={color.successHeroText}
      insets={insets}
    >
      <View
        style={{
          backgroundColor: color.surfaceRaised,
          borderWidth: 1,
          borderColor: color.border,
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <ResultRow label="Model matched" value={verification?.modelMatched ?? job?.model ?? '—'} />
        <ResultRow label="Serial read" value={verification?.serialRead ?? '—'} mono />
        <ResultRow
          label="Confidence"
          value={
            verification?.confidence === undefined
              ? '—'
              : `${verification.confidence}% · Auto-pass`
          }
          tint={color.credit}
          last
        />
      </View>

      <View style={{ marginTop: 16 }}>
        <Button
          label="Send feedback link to customer"
          onPress={() => router.replace(`/job/${jobId}/proof/closure`)}
        />
      </View>
    </Shell>
  );
}

interface ShellProps {
  gradient: readonly [string, string];
  icon: IconName;
  iconSize: number;
  title: string;
  body: string;
  bodyColor: string;
  insets: { top: number; bottom: number };
  children: React.ReactNode;
}

function Shell({
  gradient,
  icon,
  iconSize,
  title,
  body,
  bodyColor,
  insets,
  children,
}: ShellProps) {
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <LinearGradient
          colors={gradient}
          style={{
            alignItems: 'center',
            paddingTop: insets.top + 44,
            paddingHorizontal: 26,
            paddingBottom: 30,
          }}
        >
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: color.heroBadge,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <Icon name={icon} size={iconSize} color={color.textInverse} strokeWidth={2.6} />
          </Animated.View>

          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 23,
              color: color.textInverse,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 14,
              lineHeight: 21,
              color: bodyColor,
              textAlign: 'center',
              marginTop: 7,
            }}
          >
            {body}
          </Text>
        </LinearGradient>

        <View style={{ paddingVertical: 18, paddingHorizontal: 16 }}>{children}</View>
      </ScrollView>
    </View>
  );
}

interface ResultRowProps {
  label: string;
  value: string;
  mono?: boolean;
  tint?: string;
  last?: boolean;
}

function ResultRow({ label, value, mono, tint, last }: ResultRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: palette.neutral[100],
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textSecondary }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: mono ? 'RobotoMono_400Regular' : 'Roboto_700Bold',
          fontSize: 13,
          color: tint ?? color.textPrimary,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
