import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { Icon } from '@/components/icons/Icon';
import { isTooFar, metresBetween, metresLabel } from '@/lib/coordinates';
import { ScreenStatusBar, useKeyboardHeight } from '@/components/layout';
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
  const keyboardHeight = useKeyboardHeight();
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

  // How far the phone is from the customer's address, when BOTH ends have a
  // position. Null means there is nothing to measure — the ticket's address
  // was typed rather than picked, or this job predates the columns — and the
  // pincode compare below is then the rule, exactly as before.
  const distanceM = useMemo(() => {
    if (!coords || job?.latitude == null || job?.longitude == null) return null;
    return metresBetween(
      coords.latitude,
      coords.longitude,
      job.latitude,
      job.longitude,
    );
  }, [coords, job?.latitude, job?.longitude]);

  // The radius the SERVER will enforce, sent with the job. Never defaulted to
  // a number: a guess here would block captures the server would have taken.
  const radiusM = job?.geoRadiusM ?? null;

  // Two rules, and which one applies is decided by the ticket — the same fork
  // the server makes in `_check_live_was_taken_at_the_job`. A job that knows
  // where it is is judged by distance and its pincode is not consulted, so a
  // technician at the door but across a postal boundary is no longer refused.
  const elsewhere =
    distanceM !== null && radiusM !== null
      ? isTooFar(distanceM, coords?.accuracy ?? null, radiusM)
      : !!coords?.pincode && !!jobPincode && coords.pincode !== jobPincode;

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

    // Two steps do NOT advance on the shutter.
    //
    // `photos` accumulates, which was always true. `serial` is the one this
    // caught late: it needs the number typed as well as the label
    // photographed, and advancing on the photo alone walked straight past the
    // field in the most natural order there is — point the camera at the
    // label, press the button. The technician then finished the whole capture
    // and the SERVER refused the proof for a missing serial, by which time
    // they could easily have left the site. Both leave by the Next control,
    // which is gated on everything the step owes.
    if (step === 'photos' || step === 'serial') return;

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
    // The keyboard is subtracted HERE, on the root, so the camera (which is
    // `flex: 1`) gives up the height and everything below it rises with the
    // keys. `KeyboardFlow` cannot do this job: it scrolls its content, and a
    // viewfinder that scrolls is not a viewfinder.
    //
    // No `insets.bottom` on top of this — the keyboard is drawn OVER the
    // navigation bar, so its height already covers it.
    <View
      style={{ flex: 1, backgroundColor: color.cameraBg, paddingBottom: keyboardHeight }}
    >
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
            // The verdict, not the inputs to it. The badge used to work this
            // out again from the two pincodes, which is how a badge ends up
            // contradicting the shutter beside it.
            elsewhere={elsewhere}
            distanceLabel={distanceM !== null ? metresLabel(distanceM) : null}
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
                    ? distanceM !== null
                      ? `You are ${metresLabel(distanceM)} from this job. The live photo must be taken at the customer's address.`
                      : `You are at ${coords?.pincode} — this job is at ${jobPincode}. The live photo must be taken at the customer's address.`
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

      {step === 'serial' ? (
        <SerialField
          value={serialValue ?? ''}
          onChange={(text) => setSerial(text, 'manual')}
          hasPhoto={!!captureState.serial}
        />
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: color.cameraBg,
          paddingTop: 16,
          paddingHorizontal: 24,
          // With the keyboard up the root has already cleared the navigation
          // bar, so adding the inset again would leave a bar-sized gap between
          // the shutter and the keys.
          paddingBottom: keyboardHeight > 0 ? 20 : insets.bottom + 20,
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

/**
 * The typed serial, docked above the shutter.
 *
 * It used to float inside the viewfinder at `bottom: 16`, where the software
 * keyboard covered it outright — this app is edge-to-edge, so the Android
 * window does not resize for the IME and nothing moved out of its way. Docking
 * it in the chrome fixes more than the overlap: a field is a control, and a
 * control that hovers over a live camera feed reads as a caption.
 *
 * Both halves of this step are still required — the label photographed AND the
 * number typed — so this sits beside the shutter rather than replacing it.
 */
function SerialField({
  value,
  onChange,
  hasPhoto,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Whether the label itself has been photographed yet. */
  hasPhoto: boolean;
}) {
  const [focused, setFocused] = useState(false);

  // The step owes two things and the Next control simply is not drawn until it
  // has both — so this line has to be the one that says which is missing.
  // Without it the technician sees a photo taken, a camera still on screen and
  // no way forward, which reads as a broken app rather than as an unfinished
  // field.
  const helper = !value.trim()
    ? hasPhoto
      ? 'Label photographed — now type the serial'
      : 'Serial number, exactly as printed'
    : hasPhoto
      ? 'Serial number, exactly as printed'
      : 'Now photograph the label';

  return (
    <View style={{ backgroundColor: color.cameraBg, paddingHorizontal: 20, paddingTop: 4 }}>
      <Text
        style={{
          fontFamily: 'RobotoMono_400Regular',
          fontSize: 10.5,
          letterSpacing: 1.1,
          color: color.textOnChrome,
          marginBottom: 6,
        }}
      >
        SERIAL NUMBER
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: color.cameraFieldBg,
          borderRadius: 12,
          borderWidth: 1.5,
          // The focus ring is the only thing that says "this is where you are
          // typing" on a screen whose other control is a shutter.
          borderColor: focused ? color.borderFocus : color.cameraFieldBorder,
          paddingLeft: 14,
          paddingRight: 6,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="e.g. 4021884170099"
          placeholderTextColor={color.cameraDim}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          // The shutter rises above the keyboard now, so Done is a convenience
          // rather than the only way out — but a serial is one field and one
          // field should end with the keyboard gone.
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          // No format is imposed. Serial formats vary by manufacturer and a
          // mask that guessed one would refuse the others.
          style={{
            flex: 1,
            fontFamily: 'RobotoMono_700Bold',
            fontSize: 17,
            letterSpacing: 1.4,
            color: color.textInverse,
            paddingVertical: 12,
          }}
        />

        {/* A mistyped serial is the whole failure mode of this step, and
            holding backspace on 13 monospace characters is a poor apology for
            not offering this. */}
        {value.length > 0 ? (
          <Pressable
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear the serial number"
            hitSlop={8}
          >
            {({ pressed }) => (
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.5 : 1,
                }}
              >
                <Icon name="close" size={17} color={color.textOnChrome} />
              </View>
            )}
          </Pressable>
        ) : null}
      </View>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 11.5,
          color: color.cameraDim,
          marginTop: 6,
        }}
      >
        {helper}
      </Text>
    </View>
  );
}
