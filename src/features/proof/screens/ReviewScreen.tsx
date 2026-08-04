import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { STEP_CONFIG } from '@/features/proof/machine';
import { useCaptureStore, type CapturedShot } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { ProofKind } from '@/types/domain';

export interface ReviewScreenProps {
  jobId: string;
}

const TILE_ICON: Record<ProofKind, IconName> = {
  barcode: 'barcode',
  serial: 'serial',
  photos: 'photos',
  live: 'geo',
};

/**
 * Screen 13 — Review & submit.
 *
 * The last point where a bad capture is free to fix. Once submitted, a blurry
 * serial costs an ASM review or a return trip, so every tile is tappable and
 * says so.
 */
export function ReviewScreen({ jobId }: ReviewScreenProps) {
  const router = useRouter();
  const { data: job } = useJob(jobId);

  const { barcode, serial, photos, live, setStep, clearStep } = useCaptureStore();

  const retake = (step: ProofKind) => {
    clearStep(step);
    setStep(step);
    router.push(`/job/${jobId}/proof/capture`);
  };

  const tiles: { step: ProofKind; meta: string; shot: CapturedShot | null }[] = [
    { step: 'barcode', meta: 'Barcode · decoded', shot: barcode },
    { step: 'serial', meta: 'Serial · VCN-••••-8841', shot: serial },
    {
      step: 'photos',
      meta: `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`,
      shot: photos[0] ?? null,
    },
    { step: 'live', meta: `Geo-tagged · ${job?.pincode ?? ''}`, shot: live },
  ];

  return (
    <>
      <Header
        title="Review & submit"
        subtitle="Check your four captures before AI verification. Tap any to retake."
        onBack={() => router.replace(`/job/${jobId}`)}
      />

      <Screen
        footer={
          <Button
            label="Submit for AI verification"
            onPress={() => router.replace(`/job/${jobId}/proof/verifying`)}
          />
        }
      >
        <View style={{ gap: 12, marginTop: 4 }}>
          {tiles.map(({ step, meta, shot }) => (
            <Card key={step} padded={false} style={{ padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {shot ? (
                  <Image
                    source={{ uri: shot.uri }}
                    style={{ width: 52, height: 52, borderRadius: radius.sm }}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: radius.sm,
                      backgroundColor: color.surfaceSunken,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={TILE_ICON[step]} size={22} color={color.textMuted} />
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 14,
                      color: color.textPrimary,
                    }}
                  >
                    {STEP_CONFIG[step].reviewLabel}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12.5,
                      color: color.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    {meta}
                  </Text>
                </View>

                <Pressable
                  onPress={() => retake(step)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Retake ${STEP_CONFIG[step].reviewLabel}`}
                >
                  {({ pressed }) => (
                    <Text
                      style={{
                        fontFamily: 'Roboto_700Bold',
                        fontSize: 13,
                        color: color.actionBg,
                        opacity: pressed ? 0.6 : 1,
                      }}
                    >
                      Retake
                    </Text>
                  )}
                </Pressable>
              </View>
            </Card>
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            backgroundColor: color.statusCompleted.bg,
            borderRadius: radius.lg,
            padding: 14,
            marginTop: 16,
          }}
        >
          <Icon name="geo" size={17} color={color.statusCompleted.fg} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Roboto_500Medium',
              fontSize: 12.5,
              lineHeight: 19,
              color: color.statusCompleted.fg,
            }}
          >
            All photos geo-tagged &amp; matched to pincode {job?.pincode ?? ''}.
          </Text>
        </View>
      </Screen>
    </>
  );
}
