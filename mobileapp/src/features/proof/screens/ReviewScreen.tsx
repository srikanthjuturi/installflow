import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icons/Icon';
import { TitleBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { STEP_CONFIG } from '@/features/proof/machine';
import { useCaptureStore, type CapturedShot } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
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
 * The last point where a bad capture is free to fix. After submission a blurry
 * serial costs an ASM review or a return trip, so the whole tile is the retake
 * target rather than a small link at its edge.
 */
export function ReviewScreen({ jobId }: ReviewScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="dark" />
      <TitleBar title="Review & submit" onBack={() => router.replace(`/job/${jobId}`)} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            lineHeight: 19,
            color: color.textSecondary,
            marginHorizontal: 2,
            marginBottom: 14,
          }}
        >
          Check your four captures before AI verification. Tap any to retake.
        </Text>

        {tiles.map(({ step, meta, shot }) => (
          <Pressable
            key={step}
            onPress={() => retake(step)}
            accessibilityRole="button"
            accessibilityLabel={`Retake ${STEP_CONFIG[step].reviewLabel}`}
          >
            {({ pressed }) => (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  backgroundColor: color.surfaceRaised,
                  borderWidth: 1,
                  borderColor: pressed ? palette.neutral[300] : color.border,
                  borderRadius: 16,
                  padding: 12,
                  marginBottom: 11,
                }}
              >
                {shot ? (
                  <Image
                    source={{ uri: shot.uri }}
                    style={{ width: 56, height: 56, borderRadius: 12 }}
                    contentFit="cover"
                  />
                ) : (
                  <LinearGradient
                    colors={[color.thumbFrom, color.thumbTo]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={TILE_ICON[step]} size={24} color={color.textInverse} />
                  </LinearGradient>
                )}

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 14.5,
                      color: color.textPrimary,
                    }}
                  >
                    {STEP_CONFIG[step].reviewLabel}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12,
                      color: color.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    {meta}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  {/* Green tick per row: four separate things must be present,
                      and a glance down this column is how you confirm that. */}
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: color.online,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="check" size={14} color={color.textInverse} />
                  </View>

                  <Text
                    style={{ fontFamily: 'Roboto_700Bold', fontSize: 12, color: color.actionBg }}
                  >
                    Retake
                  </Text>
                </View>
              </View>
            )}
          </Pressable>
        ))}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: color.successSurface,
            borderWidth: 1,
            borderColor: color.successSurfaceBorder,
            borderRadius: 12,
            paddingVertical: 11,
            paddingHorizontal: 13,
            marginTop: 6,
          }}
        >
          <Icon name="geo" size={18} color={color.credit} strokeWidth={1.7} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Roboto_500Medium',
              fontSize: 12,
              lineHeight: 17,
              color: color.credit,
            }}
          >
            All photos geo-tagged &amp; matched to pincode {job?.pincode ?? ''}.
          </Text>
        </View>
      </ScrollView>

      <View
        style={{
          backgroundColor: color.surfaceRaised,
          borderTopWidth: 1,
          borderTopColor: palette.neutral[200],
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <Button
          label="Submit for AI verification"
          trailingIcon="arrowRight"
          onPress={() => router.replace(`/job/${jobId}/proof/verifying`)}
        />
      </View>
    </View>
  );
}
