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
/**
 * A fix, plus the postal code the device is actually in.
 *
 * Reverse geocoding is best-effort: it uses the platform geocoder, which needs
 * a network on Android and can simply return nothing. A failure costs the
 * pincode, never the coordinates — those are the exact record and are stored
 * regardless.
 */
async function describe(fix: Location.LocationObject): Promise<Coords> {
  const base: Coords = {
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    accuracy: fix.coords.accuracy ?? null,
    pincode: null,
  };
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude: base.latitude,
      longitude: base.longitude,
    });
    return { ...base, pincode: place?.postalCode ?? null };
  } catch {
    return base;
  }
}


export function CaptureScreen({ jobId }: CaptureScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const { data: job } = useJob(jobId);

  const { step, photos, start, setStep, capture } = useCaptureStore();
  const sessionJobId = useCaptureStore((s) => s.jobId);
  const upload = useUploadShot();

  // Where the phone is, for the live shot. `unavailable` is a real answer —
  // permission denied, services off, or no fix indoors — and it is recorded
  // rather than blocking the capture: a technician who has finished the work
  // must not be stranded by a GPS.
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geo, setGeo] = useState<'idle' | 'acquiring' | 'locked' | 'unavailable'>('idle');
  //: In-flight guard as a REF, not state.
  //
  //: It was state, and it was also in this effect's dependency array — so
  //: setting it re-ran the effect, React ran the CLEANUP first, and the
  //: cleanup's `cancelled = true` threw away the fix that was still arriving.
  //: The badge then sat on "Finding your location…" forever and no coordinates
  //: were ever stored. A ref changes nothing about renders, so the effect runs
  //: once and stays running.
  const askedRef = useRef(false);

  useEffect(() => {
    if (sessionJobId !== jobId) start(jobId);
  }, [jobId, sessionJobId, start]);

  // Acquire only on the step that claims it. Asking on `barcode` would put a
  // permission dialog in front of a technician three steps before it matters.
  useEffect(() => {
    if (step !== 'live') {
      // Leaving the step re-arms it, so a retake after a failure tries again.
      askedRef.current = false;
      return;
    }
    if (askedRef.current) return;
    askedRef.current = true;

    let cancelled = false;
    setGeo('acquiring');

    void (async () => {
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!granted) {
          setGeo('unavailable');
          return;
        }

        // A last-known fix first: indoors, `getCurrentPositionAsync` can sit
        // for a long time, and a minute-old position from the same street is
        // far better evidence than none. It is replaced below if a fresh one
        // arrives.
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last) {
          setCoords(await describe(last));
          setGeo('locked');
        }

        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setCoords(await describe(fix));
        setGeo('locked');
      } catch {
        // Services off, or no fix. Say so rather than spinning — the shutter
        // still works and the absence is recorded with the photo.
        if (!cancelled) setGeo((g) => (g === 'locked' ? g : 'unavailable'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step]);

  const config = STEP_CONFIG[step];

  // The live shot may only be taken where the job is.
  //
  // Two ways to fail it, and BOTH block, because a rule that passes when the
  // GPS is off is not a rule — turning location off would be the way round it.
  // The technician can retry rather than being stuck: `Retry location` clears
  // the fix and re-runs the effect.
  const jobPincode = job?.pincode ?? '';
  const elsewhere =
    !!coords?.pincode && !!jobPincode && coords.pincode !== jobPincode;
  const geoBlocked =
    step === 'live' && (geo === 'acquiring' || geo === 'unavailable' || elsewhere);

  const retryLocation = useCallback(() => {
    setCoords(null);
    setGeo('idle');
    askedRef.current = false;
  }, []);

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
            geo={geo === 'idle' ? 'acquiring' : geo}
            // The DEVICE's pincode, not the ticket's. Where the two disagree
            // the technician is not where the job is, and that is precisely
            // the thing this badge exists to show.
            devicePincode={coords?.pincode ?? null}
            coords={
              coords ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` : null
            }
            accuracyM={coords?.accuracy ?? null}
          />

          {/* Hint sits INSIDE the viewfinder, over the feed — the technician is
              looking at the frame, not at the chrome below it. */}
          <View
            style={{ position: 'absolute', bottom: 16, left: '10%', right: '10%' }}
            // `box-none`, not `none`: the container must stay transparent to
            // touches so the viewfinder behind it still works, but the blocked
            // banner below carries a "Retry location" the technician has to be
            // able to press. `none` would swallow it — children of a `none`
            // view never receive touches, whatever they ask for themselves.
            pointerEvents="box-none"
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

            {/* A blocked shutter must say WHY and offer a way forward. A
                control that simply does nothing reads as a broken app, and a
                technician who has finished the work would have no idea what to
                try next. */}
            {geoBlocked ? (
              <View
                style={{
                  marginTop: 10,
                  alignSelf: 'center',
                  maxWidth: 320,
                  backgroundColor: color.statusCancelled.bg,
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  alignItems: 'center',
                }}
                pointerEvents="auto"
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: color.debit,
                    textAlign: 'center',
                  }}
                >
                  {elsewhere
                    ? `You are at ${coords?.pincode} — this job is at ${jobPincode}. The live photo must be taken at the customer's address.`
                    : geo === 'acquiring'
                      ? 'Waiting for your location before the live photo…'
                      : 'Turn location on to take the live photo — it proves you attended.'}
                </Text>

                {geo !== 'acquiring' ? (
                  <Pressable onPress={retryLocation} accessibilityRole="button">
                    {({ pressed }) => (
                      <Text
                        style={{
                          fontFamily: 'Roboto_700Bold',
                          fontSize: 12.5,
                          color: color.debit,
                          textDecorationLine: 'underline',
                          marginTop: 8,
                          opacity: pressed ? 0.6 : 1,
                        }}
                      >
                        Retry location
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ) : null}
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
          onPress={geoBlocked ? undefined : onShutter}
          disabled={geoBlocked}
          accessibilityRole="button"
          accessibilityState={{ disabled: geoBlocked }}
          accessibilityLabel={
            geoBlocked
              ? 'Capture unavailable until your location matches the job'
              : `Capture ${config.title}`
          }
        >
          {({ pressed }) => (
            <View
              style={{
                width: 74,
                height: 74,
                borderRadius: 37,
                borderWidth: 4,
                borderColor: geoBlocked ? color.cameraDim : color.shutterRing,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: geoBlocked ? 0.4 : pressed ? 0.7 : 1,
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
