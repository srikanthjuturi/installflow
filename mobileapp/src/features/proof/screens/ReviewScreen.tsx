import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icons/Icon';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { useRetryFailedUploads, useSubmitProof } from '@/features/proof/hooks/useProof';
import { ShotPreview } from '@/features/proof/components/ShotPreview';
import { MAX_PHOTOS, STEP_CONFIG } from '@/features/proof/machine';
import {
  allShots,
  isProofUploaded,
  useCaptureStore,
  type CapturedShot,
} from '@/store/capture.store';
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

  const {
    barcode,
    serial,
    photos,
    live,
    serialValue,
    serialSource,
    setStep,
    clearStep,
    removePhoto,
  } = useCaptureStore();
  const scanned = serialSource === 'scanned';
  //: Which shot is open full screen. Tapping a tile opens this; it used to
  //: delete the capture and reopen the camera on the same tap.
  const [preview, setPreview] = useState<{ shot: CapturedShot; step: ProofKind } | null>(
    null,
  );
  const ready = useCaptureStore(isProofUploaded);
  const uploading = useCaptureStore((s) =>
    allShots(s).some(({ shot }) => shot.upload === 'uploading' || shot.upload === 'pending'),
  );
  const anyFailed = useCaptureStore((s) =>
    allShots(s).some(({ shot }) => shot.upload === 'failed'),
  );
  const retryFailed = useRetryFailedUploads();
  const submit = useSubmitProof(jobId);

  const retake = (step: ProofKind) => {
    setPreview(null);
    clearStep(step);
    setStep(step);
    router.push(`/job/${jobId}/proof/capture`);
  };

  /** Take MORE product photos without discarding the ones already taken. */
  const addPhotos = () => {
    setPreview(null);
    setStep('photos');
    router.push(`/job/${jobId}/proof/capture`);
  };

  /**
   * What the preview's destructive button does, which differs by kind.
   *
   * Removing one product photo is not the same act as retaking the serial —
   * the first leaves three good shots behind, the second replaces the only one
   * there is. The button says which it is about to do.
   */
  const previewAction = () => {
    if (!preview) return null;
    if (preview.step !== 'photos') {
      return { label: 'Retake this', onPress: () => retake(preview.step) };
    }
    if (photos.length > 1) {
      return {
        label: 'Remove this photo',
        onPress: () => {
          removePhoto(preview.shot.uri);
          setPreview(null);
        },
      };
    }
    // The last one. Removing it leaves nothing, so this is a retake.
    return { label: 'Retake this', onPress: () => retake('photos') };
  };

  // Nothing has been read yet at this point — a CapturedShot is a file URI and
  // a timestamp, and the AI run only starts after this screen submits. So these
  // say what is true (an artifact was captured); the decoded barcode and the
  // serial appear on the result screen, which has them.
  // Each row reports what is actually true of its own artifact: captured or
  // not, uploaded or not, geo-tagged or not. Every one of these used to be a
  // fixed string with a green tick beside it regardless of state.
  const tiles: { step: ProofKind; meta: string; shot: CapturedShot | null }[] = [
    {
      step: 'barcode',
      meta: scanned ? `Read · ${serialValue}` : 'Captured · did not scan',
      shot: barcode,
    },
    // Present only when the barcode would not scan. With a successful read the
    // number is already in hand and this row would be a step that proved
    // something already proved.
    ...(scanned
      ? []
      : [
          {
            step: 'serial' as ProofKind,
            meta: serialValue ? `Entered · ${serialValue}` : 'Serial not entered',
            shot: serial,
          },
        ]),
    {
      step: 'photos',
      meta:
        photos.length === 0
          ? 'No product photos yet'
          : `${photos.length} of ${MAX_PHOTOS} · tap one to see it`,
      shot: photos[0] ?? null,
    },
    {
      step: 'live',
      meta: live?.coords
        ? `Geo-tagged · ${live.coords.pincode ?? `${live.coords.latitude.toFixed(4)}, ${live.coords.longitude.toFixed(4)}`}`
        : 'Live photo · no location recorded',
      shot: live,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
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
          Tap any capture to see it full screen. Retake anything that isn&apos;t clear — after you submit, a blurry serial costs a second visit.
        </Text>

        {tiles.map(({ step, meta, shot }) => (
          <Pressable
            key={step}
            // Opens the picture. It used to delete it.
            onPress={() => (shot ? setPreview({ shot, step }) : retake(step))}
            accessibilityRole="button"
            accessibilityLabel={
              shot
                ? `View ${STEP_CONFIG[step].reviewLabel}`
                : `Capture ${STEP_CONFIG[step].reviewLabel}`
            }
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
                  {/* The tick means UPLOADED, not merely captured — a photo
                      still on the phone is not proof of anything. It used to
                      render green unconditionally, on every row, always. */}
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor:
                        shot?.upload === 'done'
                          ? color.online
                          : shot?.upload === 'failed'
                            ? color.debit
                            : color.borderStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {shot?.upload === 'uploading' || shot?.upload === 'pending' ? (
                      <ActivityIndicator size="small" color={color.textInverse} />
                    ) : (
                      <Icon
                        name={shot?.upload === 'failed' ? 'warn' : 'check'}
                        size={14}
                        color={color.textInverse}
                      />
                    )}
                  </View>

                  {/* The one destructive control on this row, and now the
                      only one — labelled, separate from the picture, and it
                      says "Add" where more shots are welcome rather than
                      "Retake", which would throw away the ones already taken. */}
                  <Pressable
                    onPress={() =>
                      step === 'photos' && photos.length > 0 && photos.length < MAX_PHOTOS
                        ? addPhotos()
                        : retake(step)
                    }
                    hitSlop={10}
                    accessibilityRole="button"
                  >
                    {({ pressed }) => (
                      <Text
                        style={{
                          fontFamily: 'Roboto_700Bold',
                          fontSize: 12,
                          color: color.actionBg,
                          opacity: pressed ? 0.6 : 1,
                        }}
                      >
                        {step === 'photos' && photos.length > 0 && photos.length < MAX_PHOTOS
                          ? 'Add'
                          : 'Retake'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </Pressable>
        ))}

        {/* Every product photo, not just the first. Shots two to four were
            captured, uploaded and submitted while being invisible on the one
            screen whose whole job is checking them. */}
        {photos.length > 1 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: -3,
              marginBottom: 12,
              paddingHorizontal: 2,
            }}
          >
            {photos.map((shot, i) => (
              <Pressable
                key={shot.uri}
                onPress={() => setPreview({ shot, step: 'photos' })}
                accessibilityRole="button"
                accessibilityLabel={`View product photo ${i + 1} of ${photos.length}`}
              >
                {({ pressed }) => (
                  <View style={{ opacity: pressed ? 0.7 : 1 }}>
                    <Image
                      source={{ uri: shot.uri }}
                      style={{ width: 64, height: 64, borderRadius: 12 }}
                      contentFit="cover"
                    />
                    {shot.upload !== 'done' ? (
                      <View
                        style={{
                          position: 'absolute',
                          right: 4,
                          bottom: 4,
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor:
                            shot.upload === 'failed' ? color.debit : color.borderStrong,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {shot.upload === 'failed' ? (
                          <Icon name="warn" size={10} color={color.textInverse} />
                        ) : (
                          <ActivityIndicator size="small" color={color.textInverse} />
                        )}
                      </View>
                    ) : null}
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        ) : null}

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
            {/* Says what happened, not what we wish had. This line used to
                claim every photo was geo-tagged and matched to the pincode
                while nothing read the GPS at all. */}
            {/* The DEVICE's position, exactly as captured — never the ticket's
                pincode, which is where the job is rather than where the phone
                was. Coordinates are the record; the postal code is only a
                readable name for them. */}
            {live?.coords
              ? `Live photo taken at ${live.coords.latitude.toFixed(5)}, ${live.coords.longitude.toFixed(5)}` +
                (live.coords.pincode ? ` — ${live.coords.pincode}` : '') +
                (live.coords.accuracy ? ` (±${Math.round(live.coords.accuracy)}m)` : '')
              : 'No location was recorded with the live photo.'}
          </Text>
        </View>
      </ScrollView>

      <ShotPreview
        shot={preview?.shot ?? null}
        title={preview ? STEP_CONFIG[preview.step].reviewLabel : ''}
        action={previewAction()}
        onClose={() => setPreview(null)}
      />

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
        {anyFailed ? (
          <Button
            label="Retry failed uploads"
            variant="secondary"
            leadingIcon="warn"
            onPress={retryFailed}
          />
        ) : (
          <Button
            label="Submit & start job"
            trailingIcon="arrowRight"
            loading={submit.isPending}
            // Gated on UPLOADED, not captured. The call sends blob names, so a
            // shot still in flight has nothing to send — enabling this early
            // would earn a 400 that looks like the app's fault.
            disabled={!ready || uploading}
            disabledHint={
              uploading
                ? 'Waiting for photos to upload…'
                : 'Capture all four before submitting'
            }
            onPress={() =>
              submit.mutate(undefined, {
                onSuccess: () => router.replace(`/job/${jobId}`),
              })
            }
          />
        )}

        {submit.isError ? (
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12,
              color: color.debit,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            {submit.error instanceof Error ? submit.error.message : "Couldn't submit"}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
