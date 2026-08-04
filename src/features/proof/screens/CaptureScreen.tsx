import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { CaptureOverlay } from '@/features/proof/components/CaptureOverlay';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { MAX_PHOTOS, MIN_PHOTOS, STEP_CONFIG, nextStep, stepLabel } from '@/features/proof/machine';
import { useCaptureStore } from '@/store/capture.store';
import { color } from '@/theme/semantic';
import { layout, radius } from '@/theme/spacing';

export interface CaptureScreenProps {
  jobId: string;
}

/**
 * Screens 9–12 — proof capture.
 *
 * One camera screen with four modes rather than four screens: the chrome,
 * permission handling and shutter are identical, and only the framing guide
 * and what a capture does differ.
 */
export function CaptureScreen({ jobId }: CaptureScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const { data: job } = useJob(jobId);

  const { step, photos, start, setStep, capture } = useCaptureStore();
  const sessionJobId = useCaptureStore((s) => s.jobId);

  useEffect(() => {
    if (sessionJobId !== jobId) start(jobId);
  }, [jobId, sessionJobId, start]);

  const config = STEP_CONFIG[step];

  const onShutter = async () => {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (!photo) return;

    capture(step, { uri: photo.uri, capturedAt: Date.now() });

    // Photos accumulate and advance manually; every other step is one-and-done.
    if (step === 'photos') return;

    const next = nextStep(step);
    if (next) setStep(next);
    else router.replace(`/job/${jobId}/proof/review`);
  };

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: color.cameraBg }} />;
  }

  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: color.cameraBg,
          justifyContent: 'center',
          paddingHorizontal: layout.screenGutter,
        }}
      >
        <Icon name="photos" size={40} color={color.textInverse} />
        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 22,
            color: color.textInverse,
            marginTop: 18,
          }}
        >
          Camera access needed
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.textMuted,
            marginTop: 8,
            marginBottom: 28,
          }}
        >
          Proof of installation must be captured live on site. Gallery uploads aren&apos;t
          accepted, so the job can&apos;t be completed without the camera.
        </Text>

        <Button label="Allow camera" onPress={requestPermission} />
        <View style={{ height: 10 }} />
        <Button label="Back to job" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const canAdvancePhotos = photos.length >= MIN_PHOTOS;

  return (
    <View style={{ flex: 1, backgroundColor: color.cameraBg }}>
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingBottom: 12,
          paddingHorizontal: layout.screenGutter,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to job"
        >
          <Icon name="chevronLeft" size={24} color={color.textInverse} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text
            style={{ fontFamily: 'Roboto_700Bold', fontSize: 16, color: color.textInverse }}
          >
            {config.title}
          </Text>
          <Text
            style={{ fontFamily: 'Roboto_400Regular', fontSize: 12, color: color.textMuted }}
          >
            {stepLabel(step)}
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
          <CaptureOverlay step={step} pincode={job?.pincode ?? ''} />
        </CameraView>
      </View>

      <View
        style={{
          paddingTop: 14,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: layout.screenGutter,
        }}
      >
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            color: color.textMuted,
            textAlign: 'center',
            marginBottom: 14,
          }}
        >
          {config.hint}
        </Text>

        {step === 'photos' && photos.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            {photos.map((shot) => (
              <Image
                key={shot.uri}
                source={{ uri: shot.uri }}
                style={{ width: 44, height: 44, borderRadius: radius.sm }}
                contentFit="cover"
              />
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            {step === 'photos' ? (
              <Text
                style={{ fontFamily: 'Roboto_500Medium', fontSize: 13, color: color.textMuted }}
              >
                {photos.length}/{MAX_PHOTOS}
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={onShutter}
            accessibilityRole="button"
            accessibilityLabel={`Capture ${config.title}`}
          >
            {({ pressed }) => (
              <View
                style={{
                  width: layout.shutterSize,
                  height: layout.shutterSize,
                  borderRadius: radius.full,
                  borderWidth: 4,
                  borderColor: color.textInverse,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                }}
              >
                <View
                  style={{
                    width: layout.shutterSize - 18,
                    height: layout.shutterSize - 18,
                    borderRadius: radius.full,
                    backgroundColor: color.textInverse,
                  }}
                />
              </View>
            )}
          </Pressable>

          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {step === 'photos' ? (
              <Pressable
                onPress={() => canAdvancePhotos && setStep('live')}
                disabled={!canAdvancePhotos}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canAdvancePhotos }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 15,
                    color: canAdvancePhotos ? color.actionBg : color.textMuted,
                  }}
                >
                  Next
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
