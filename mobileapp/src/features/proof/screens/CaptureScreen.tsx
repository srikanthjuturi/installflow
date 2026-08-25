import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { CaptureOverlay } from '@/features/proof/components/CaptureOverlay';
import { MAX_PHOTOS, MIN_PHOTOS, STEP_CONFIG, nextStep, stepLabel } from '@/features/proof/machine';
import { useUploadShot } from '@/features/proof/hooks/useProof';
import { newShot, useCaptureStore, type Coords } from '@/store/capture.store';
import { color } from '@/theme/semantic';

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
  const upload = useUploadShot();

  // Where the phone is, for the live shot. `null` is a real answer — permission
  // denied, or no fix — and it is recorded rather than blocking the capture: a
  // technician who has finished the work must not be stranded by a GPS.
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (sessionJobId !== jobId) start(jobId);
  }, [jobId, sessionJobId, start]);

  // Acquire only on the step that claims it. Asking on `barcode` would put a
  // permission dialog in front of a technician three steps before it matters.
  useEffect(() => {
    if (step !== 'live' || coords || locating) return;
    let cancelled = false;

    void (async () => {
      setLocating(true);
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (!granted || cancelled) return;
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setCoords({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracy: fix.coords.accuracy ?? null,
        });
      } catch {
        // Location services off, or no fix indoors. Recorded as absent.
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, coords, locating]);

  const config = STEP_CONFIG[step];

  const onShutter = useCallback(async () => {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (!photo) return;

    const shot = newShot(photo.uri, step === 'live' ? coords : undefined);
    capture(step, shot);
    // Straight to blob storage, without awaiting. The shutter must not wait on
    // a round trip, and the review screen shows how each one got on.
    upload(shot);

    // Photos accumulate and advance manually; every other step is one-and-done.
    if (step === 'photos') return;

    const next = nextStep(step);
    if (next) setStep(next);
    else router.replace(`/job/${jobId}/proof/review`);
  }, [capture, coords, jobId, router, setStep, step, upload]);

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
          paddingHorizontal: 24,
        }}
      >
        <ScreenStatusBar style="light" />
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
            color: color.textOnChrome,
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
      <ScreenStatusBar style="light" />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to job"
        >
          {({ pressed }) => (
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                backgroundColor: color.cameraTopControl,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              }}
            >
              <Icon name="chevronLeft" size={22} color={color.textInverse} />
            </View>
          )}
        </Pressable>

        <View>
          <Text
            style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textInverse }}
          >
            {config.title}
          </Text>
          <Text
            style={{ fontFamily: 'Roboto_400Regular', fontSize: 11.5, color: color.textOnChrome }}
          >
            {stepLabel(step)}
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
          <CaptureOverlay
            step={step}
            pincode={job?.pincode ?? ''}
            photoCount={photos.length}
            geo={coords ? 'locked' : locating ? 'acquiring' : 'unavailable'}
          />

          {/* Hint sits INSIDE the viewfinder, over the feed — the technician is
              looking at the frame, not at the chrome below it. */}
          <View
            style={{ position: 'absolute', bottom: 16, left: '10%', right: '10%' }}
            pointerEvents="none"
          >
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12.5,
                color: color.cameraHint,
                textAlign: 'center',
              }}
            >
              {config.hint}
            </Text>
          </View>
        </CameraView>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: color.cameraBg,
          paddingTop: 16,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 20,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
            backgroundColor: color.cameraBottomControl,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="edit" size={22} color={color.cameraDim} />
        </View>

        <Pressable
          onPress={onShutter}
          accessibilityRole="button"
          accessibilityLabel={`Capture ${config.title}`}
        >
          {({ pressed }) => (
            <View
              style={{
                width: 74,
                height: 74,
                borderRadius: 37,
                borderWidth: 4,
                borderColor: color.shutterRing,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: color.textInverse,
                }}
              />
            </View>
          )}
        </Pressable>

        {step === 'photos' ? (
          <Pressable
            onPress={() => canAdvancePhotos && setStep('live')}
            disabled={!canAdvancePhotos}
            accessibilityRole="button"
            accessibilityLabel="Continue to live photo"
            accessibilityState={{ disabled: !canAdvancePhotos }}
            style={{ width: 56 }}
          >
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 13,
                textAlign: 'center',
                color: canAdvancePhotos ? color.pillChromeFg : color.cameraDim,
              }}
            >
              Next
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 11,
                textAlign: 'center',
                color: color.cameraDim,
              }}
            >
              {photos.length}/{MAX_PHOTOS}
            </Text>
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>
    </View>
  );
}
