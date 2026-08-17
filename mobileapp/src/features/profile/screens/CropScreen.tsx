import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { saveMyProfilePhoto } from '@/features/auth/api/session';
import { getAccessToken } from '@/store/session.store';
import { qk } from '@/lib/queryKeys';
import { uploadImage } from '@/lib/uploads';
import { useProfileStore } from '@/store/profile.store';
import { color } from '@/theme/semantic';

export interface CropScreenProps {
  uri: string;
  width: number;
  height: number;
}

/**
 * Square crop, built rather than delegated.
 *
 * `allowsEditing` hands off to the platform cropper, whose toolbar inherits
 * the HOST app's Android theme — which under Expo Go is Expo Go's, leaving
 * dark icons on a dark bar and no visible Done action. That's unfixable from
 * config, so this screen owns the whole interaction instead: same chrome as
 * the camera, an obvious Done, and identical behaviour in Expo Go and a
 * production build.
 *
 * Pan and pinch move the IMAGE under a fixed square frame. Clamping keeps the
 * image covering the frame at all times, so an empty corner can never be
 * committed.
 */
export function CropScreen({ uri, width, height }: CropScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const setAvatar = useProfileStore((s) => s.setAvatar);
  const clearAvatar = useProfileStore((s) => s.clearAvatar);
  const queryClient = useQueryClient();

  const [source, setSource] = useState({ uri, width, height });
  const [busy, setBusy] = useState(false);

  const FRAME = Math.min(screenW - 48, 320);

  // Scale that makes the image just cover the frame — the floor for zoom.
  const baseScale = Math.max(FRAME / source.width, FRAME / source.height);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const reset = () => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  };

  /** Keeps the image covering the frame after any gesture. */
  const clamp = () => {
    'worklet';
    const shownW = source.width * baseScale * scale.value;
    const shownH = source.height * baseScale * scale.value;
    const maxX = Math.max(0, (shownW - FRAME) / 2);
    const maxY = Math.max(0, (shownH - FRAME) / 2);

    tx.value = withTiming(Math.min(maxX, Math.max(-maxX, tx.value)), { duration: 120 });
    ty.value = withTiming(Math.min(maxY, Math.max(-maxY, ty.value)), { duration: 120 });
    savedTx.value = Math.min(maxX, Math.max(-maxX, savedTx.value));
    savedTy.value = Math.min(maxY, Math.max(-maxY, savedTy.value));
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      clamp();
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      clamp();
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const rotate = async () => {
    setBusy(true);
    try {
      // Apply the rotation immediately and work from the result, so the crop
      // maths never has to reason about an unrotated source.
      const context = ImageManipulator.ImageManipulator.manipulate(source.uri);
      context.rotate(90);
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 0.9,
      });

      setSource({ uri: saved.uri, width: saved.width, height: saved.height });
      reset();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      // Display pixels per source pixel.
      const effective = baseScale * scale.value;
      const cropSize = FRAME / effective;

      const centerX = source.width / 2 - tx.value / effective;
      const centerY = source.height / 2 - ty.value / effective;

      const originX = Math.min(
        Math.max(0, centerX - cropSize / 2),
        Math.max(0, source.width - cropSize),
      );
      const originY = Math.min(
        Math.max(0, centerY - cropSize / 2),
        Math.max(0, source.height - cropSize),
      );

      const context = ImageManipulator.ImageManipulator.manipulate(source.uri);
      context.crop({
        originX: Math.round(originX),
        originY: Math.round(originY),
        width: Math.round(Math.min(cropSize, source.width)),
        height: Math.round(Math.min(cropSize, source.height)),
      });
      context.resize({ width: 512, height: 512 });

      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 0.85,
      });

      // Shown immediately, from the local file — the upload is what makes it
      // permanent, not what makes it visible.
      setAvatar(saved.uri);

      // No session yet means this is the registration flow: the account does
      // not exist, so there is nothing to attach a photo to and nobody to
      // authenticate the upload. RegisterVerifyScreen sends it the moment the
      // technician is signed in.
      if (getAccessToken()) {
        try {
          const url = await uploadImage(saved.uri, 'profile');
          await saveMyProfilePhoto(url);
          // Swap the local path for the stored URL, so the photo survives a
          // reinstall and shows on every other device.
          setAvatar(url);
          await queryClient.invalidateQueries({ queryKey: qk.me() });
        } catch {
          // Roll the optimistic preview back rather than leave a face on
          // screen that no other device will ever show.
          clearAvatar();
          Alert.alert("Couldn't save your photo", 'Check your connection and try again.');
        }
      }
      // `back()`, not `dismissAll()`: the picker sheet `replace`s itself with
      // this screen, so exactly one modal is ever on the stack and the two are
      // identical here — but `back()` also returns correctly when the crop was
      // opened from the registration flow rather than from Profile.
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const shownW = source.width * baseScale;
  const shownH = source.height * baseScale;

  return (
    <View style={{ flex: 1, backgroundColor: color.cameraBg }}>
      <StatusBar style="light" />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          {({ pressed }) => (
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 15,
                color: color.textInverse,
                opacity: pressed ? 0.6 : 1,
              }}
            >
              Cancel
            </Text>
          )}
        </Pressable>

        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Roboto_700Bold',
            fontSize: 16,
            color: color.textInverse,
          }}
        >
          Crop photo
        </Text>

        <Pressable
          onPress={busy ? undefined : confirm}
          hitSlop={10}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          {({ pressed }) => (
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 15,
                color: busy ? color.cameraDim : color.pillChromeFg,
                opacity: pressed ? 0.6 : 1,
              }}
            >
              Done
            </Text>
          )}
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <GestureDetector gesture={gesture}>
          <View
            style={{
              width: FRAME,
              height: FRAME,
              overflow: 'hidden',
              borderRadius: 8,
              backgroundColor: color.chrome,
            }}
          >
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  left: (FRAME - shownW) / 2,
                  top: (FRAME - shownH) / 2,
                  width: shownW,
                  height: shownH,
                },
                imageStyle,
              ]}
            >
              <Image
                source={{ uri: source.uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </Animated.View>
          </View>
        </GestureDetector>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            color: color.cameraHint,
            marginTop: 20,
          }}
        >
          Drag to reposition · pinch to zoom
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          paddingBottom: insets.bottom + 24,
          paddingTop: 8,
        }}
      >
        <Pressable
          onPress={busy ? undefined : rotate}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Rotate 90 degrees"
        >
          {({ pressed }) => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                height: 44,
                paddingHorizontal: 18,
                borderRadius: 12,
                backgroundColor: color.cameraTopControl,
                opacity: pressed || busy ? 0.6 : 1,
              }}
            >
              <Icon name="rotate" size={20} color={color.textInverse} />
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 14,
                  color: color.textInverse,
                }}
              >
                Rotate
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {busy ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.overlay,
          }}
        >
          <ActivityIndicator size="large" color={color.textInverse} />
        </View>
      ) : null}
    </View>
  );
}