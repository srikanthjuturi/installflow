import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { CaptureOverlay } from '@/features/proof/components/CaptureOverlay';
import { ShotPreview } from '@/features/proof/components/ShotPreview';
import {
  MAX_PHOTOS,
  MIN_PHOTOS,
  STEP_CONFIG,
  nextStep,
  prevStep,
  stepLabel,
  stepsFor,
} from '@/features/proof/machine';
import { useUploadShot } from '@/features/proof/hooks/useProof';
import {
  allShots,
  newShot,
  useCaptureStore,
  type CapturedShot,
  type Coords,
} from '@/store/capture.store';
import { color } from '@/theme/semantic';
import type { ProofKind } from '@/types/domain';

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
/** Every type `expo-camera` can decode. See the CameraView props below. */
const BARCODE_TYPES: BarcodeType[] = [
  'code128',
  'code39',
  'code93',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'itf14',
  'codabar',
  'qr',
  'pdf417',
  'aztec',
  'datamatrix',
];

/** Long enough for a cold GPS outdoors, short enough not to feel hung. */
const GPS_TIMEOUT_MS = 15_000;

/** Resolves to null rather than hanging forever. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

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

  const captureState = useCaptureStore();
  const { step, photos, start, setStep, capture, clearStep } = captureState;
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
  //: Bumped by "Retry location" so the effect above actually runs again.
  const [attempt, setAttempt] = useState(0);
  //: WHY the live step is blocked, so the message can name the fix. Denied
  //: permission, denied-for-good, services off and no-fix each need a
  //: different action from the technician.
  const [blocker, setBlocker] = useState<
    'permission' | 'permission-settings' | 'services' | 'no-fix' | null
  >(null);

  useEffect(() => {
    if (sessionJobId !== jobId) start(jobId);
  }, [jobId, sessionJobId, start]);

  // Acquire only on the step that claims it. Asking on `barcode` would put a
  // permission dialog in front of a technician three steps before it matters.
  //
  // `attempt` is in the dependency list and that is the whole point of it: the
  // retry resets the ref and bumps this counter, because resetting the ref
  // alone changed nothing — the effect only re-runs when a DEPENDENCY changes,
  // and `step` is still 'live'. "Retry location" did nothing at all.
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
    setBlocker(null);

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) {
          // `canAskAgain: false` means the OS will never show the dialog
          // again, so a retry button is a dead end — only Settings can undo
          // it, and saying "retry" would be a lie.
          setBlocker(permission.canAskAgain ? 'permission' : 'permission-settings');
          setGeo('unavailable');
          return;
        }

        // Services off is a different problem from permission refused, and it
        // has a different fix. Checked separately so the message can say which.
        if (!(await Location.hasServicesEnabledAsync())) {
          if (cancelled) return;
          setBlocker('services');
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

        // Bounded. `getCurrentPositionAsync` can hang indefinitely indoors, and
        // an unbounded await is what leaves the badge spinning with no way out.
        const fix = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          GPS_TIMEOUT_MS,
        );
        if (cancelled) return;
        if (fix) {
          setCoords(await describe(fix));
          setGeo('locked');
        } else if (!last) {
          setBlocker('no-fix');
          setGeo('unavailable');
        }
      } catch {
        if (cancelled) return;
        setGeo((g) => (g === 'locked' ? g : 'unavailable'));
        setBlocker((b) => b ?? 'no-fix');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, attempt]);

  const { serialValue, serialSource, setSerial } = captureState;

  // The route this visit actually walks. Skipping the serial step is what the
  // scan BUYS: the number is already in hand, so photographing the label as
  // well would prove something already proved.
  const steps = useMemo(() => stepsFor(serialSource === 'scanned'), [serialSource]);

  // A barcode fires this repeatedly while it stays in frame. The ref stops the
  // second reading re-entering the whole advance, which would skip a step.
  const scannedRef = useRef(false);
  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (step !== 'barcode' || scannedRef.current) return;
      const value = (data ?? '').trim();
      if (!value) return;
      scannedRef.current = true;
      setSerial(value, 'scanned');
    },
    [setSerial, step],
  );

  useEffect(() => {
    // Re-arm when the technician comes back to redo the barcode.
    if (step !== 'barcode') scannedRef.current = false;
  }, [step]);

  const config = STEP_CONFIG[step];

  // The most recent capture across every step, so the thumbnail shows what was
  // just taken even though a single-shot step advances away from it.
  // Derived with useMemo, NOT with a store selector.
  //
  // `allShots` builds a fresh array of fresh objects every call, so as a
  // selector it returned a new reference on each read — which is exactly what
  // `useSyncExternalStore` treats as "the store changed", and the render loop
  // never settled. React said so plainly: "the result of getSnapshot should be
  // cached". The subscription is the whole-state one above; this only recomputes
  // when that changes.
  const lastShot = useMemo(() => {
    const all = allShots(captureState);
    return all.length ? all[all.length - 1] : null;
  }, [captureState]);
  const [preview, setPreview] = useState<{ kind: ProofKind; shot: CapturedShot } | null>(
    null,
  );

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

  /**
   * The header chevron walks BACK through the steps, and only leaves the flow
   * from the first one.
   *
   * It called `router.back()` unconditionally, so a technician on step three
   * who wanted to redo the serial was thrown out of capture entirely — the one
   * control shaped like "go back one" was the one that abandoned everything.
   *
   * The previous step's shot is deliberately left in place: this is navigation,
   * not a retake. Whatever is there can be looked at from the thumbnail and
   * replaced from the preview, which is where discarding a capture belongs.
   */
  const goBack = useCallback(() => {
    const previous = prevStep(step, steps);
    if (previous) setStep(previous);
    else router.back();
  }, [router, setStep, step, steps]);

  const retryLocation = useCallback(() => {
    setCoords(null);
    setGeo('idle');
    setBlocker(null);
    askedRef.current = false;
    // The bump is what re-runs the effect. Clearing the ref alone did nothing.
    setAttempt((n) => n + 1);
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

    const next = nextStep(step, steps);
    if (next) setStep(next);
    else router.replace(`/job/${jobId}/proof/review`);
  }, [capture, coords, jobId, router, setStep, step, steps, upload]);

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

  // This step already holds what it needs, so moving on is allowed without
  // taking another picture. For `photos` that is at least one; for the other
  // three it is the single shot itself.
  const captured =
    step === 'photos'
      ? canAdvancePhotos
      : step === 'serial'
        ? // Both: the label photographed AND the number typed. A photo with no
          // number leaves nothing searchable; a number with no photo is only an
          // assertion. This step exists precisely because the barcode failed.
          !!captureState.serial && !!(serialValue ?? '').trim()
        : !!captureState[step];
  const canAdvance = captured && !(step === 'live' && geoBlocked);

  const advance = () => {
    const next = nextStep(step, steps);
    if (next) setStep(next);
    else router.replace(`/job/${jobId}/proof/review`);
  };

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
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={
            prevStep(step, steps)
              ? `Back to ${STEP_CONFIG[prevStep(step, steps)!].title}`
              : 'Back to job'
          }
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
            {stepLabel(step, steps)}
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="back"
          // Every symbology the camera supports. An appliance label could carry
          // any of them, and reading the wrong-but-present code is a far
          // smaller problem than failing to read the right one.
          barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
          // Only armed on the barcode step. Left on, it would quietly decode
          // something in frame while the technician was photographing the unit.
          onBarcodeScanned={step === 'barcode' ? onBarcodeScanned : undefined}
        >
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
            {step === 'barcode' && serialValue && serialSource === 'scanned' ? (
              <View
                style={{
                  marginTop: 10,
                  alignSelf: 'center',
                  backgroundColor: color.geoLockBg,
                  borderRadius: 12,
                  paddingVertical: 9,
                  paddingHorizontal: 14,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'RobotoMono_700Bold',
                    fontSize: 13,
                    color: color.textInverse,
                    textAlign: 'center',
                  }}
                >
                  {serialValue}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 11,
                    color: color.textOnChrome,
                    textAlign: 'center',
                    marginTop: 2,
                  }}
                >
                  Serial read from the barcode
                </Text>
              </View>
            ) : null}

            {step === 'serial' ? (
              <View
                style={{
                  marginTop: 10,
                  alignSelf: 'center',
                  width: '100%',
                  backgroundColor: color.cameraTopControl,
                  borderRadius: 12,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
                pointerEvents="auto"
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 11,
                    color: color.textOnChrome,
                    marginBottom: 4,
                  }}
                >
                  Serial number, exactly as printed
                </Text>
                <TextInput
                  value={serialValue ?? ''}
                  onChangeText={(text) => setSerial(text, 'manual')}
                  placeholder="e.g. 4021884170099"
                  placeholderTextColor={color.cameraDim}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  // No format is imposed. Serial formats vary by manufacturer
                  // and a mask that guessed one would refuse the others.
                  style={{
                    fontFamily: 'RobotoMono_700Bold',
                    fontSize: 16,
                    letterSpacing: 1.2,
                    color: color.textInverse,
                    paddingVertical: 4,
                  }}
                />
              </View>
            ) : null}

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
                      ? 'Finding your location before the live photo…'
                      : blocker === 'permission-settings'
                        ? 'Location is turned off for this app. Open Settings and allow location, then try again.'
                        : blocker === 'services'
                          ? 'Location services are off on this phone. Switch them on, then try again.'
                          : blocker === 'no-fix'
                            ? 'No location fix yet. Step outside or nearer a window and try again.'
                            : 'Allow location to take the live photo — it proves you attended.'}
                </Text>

                {geo !== 'acquiring' ? (
                  <Pressable
                    // Settings is the ONLY way back once the OS has stopped
                    // asking, so offering "Retry" there would be a dead end
                    // dressed as an action.
                    onPress={
                      blocker === 'permission-settings' || blocker === 'services'
                        ? () => void Linking.openSettings()
                        : retryLocation
                    }
                    accessibilityRole="button"
                  >
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
                        {blocker === 'permission-settings' || blocker === 'services'
                          ? 'Open Settings'
                          : 'Retry location'}
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
        {/* The last thing captured, tappable.
            This was a 44×44 tile with an `edit` glyph that was not a Pressable
            and did nothing at all — chrome shaped like a control. A technician
            who has just taken the barcode is advanced straight to the serial
            with no way to check what they got; the shot itself is the useful
            thing to put here, and it is one tap to look at it. */}
        {lastShot ? (
          <Pressable
            onPress={() => setPreview(lastShot)}
            accessibilityRole="button"
            accessibilityLabel={`View the ${STEP_CONFIG[lastShot.kind].reviewLabel} you just captured`}
          >
            {({ pressed }) => (
              <View style={{ opacity: pressed ? 0.7 : 1 }}>
                <Image
                  source={{ uri: lastShot.shot.uri }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    borderWidth: 1.5,
                    borderColor: color.cameraBottomControl,
                  }}
                  contentFit="cover"
                />
              </View>
            )}
          </Pressable>
        ) : (
          // Nothing captured yet. An empty box rather than a fake button —
          // it holds the shutter centred without pretending to be pressable.
          <View style={{ width: 44, height: 44 }} />
        )}

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

        {/* Forward, without recapturing.
            Only `photos` had this, so a technician who stepped BACK to check
            the serial was trapped: the step advanced on capture and nothing
            else, and the sole way onward was to retake a photo that was
            already good. Any step holding a capture can now move on. */}
        {canAdvance ? (
          <Pressable
            onPress={advance}
            accessibilityRole="button"
            accessibilityLabel={
              nextStep(step, steps)
                ? `Continue to ${STEP_CONFIG[nextStep(step, steps)!].title}`
                : 'Review captures'
            }
            style={{ width: 56 }}
          >
            {({ pressed }) => (
              <View style={{ opacity: pressed ? 0.6 : 1 }}>
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 13,
                    textAlign: 'center',
                    color: color.pillChromeFg,
                  }}
                >
                  {nextStep(step, steps) ? 'Next' : 'Review'}
                </Text>
                {step === 'photos' ? (
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
                ) : null}
              </View>
            )}
          </Pressable>
        ) : (
          <View style={{ width: 56 }} />
        )}
      </View>

      <ShotPreview
        shot={preview?.shot ?? null}
        title={preview ? STEP_CONFIG[preview.kind].reviewLabel : ''}
        action={
          preview
            ? {
                label: 'Retake this',
                onPress: () => {
                  const kind = preview.kind;
                  setPreview(null);
                  clearStep(kind);
                  setStep(kind);
                },
              }
            : null
        }
        onClose={() => setPreview(null)}
      />
    </View>
  );
}
