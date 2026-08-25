import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Button } from '@/components/ui';
import { saveMyProfilePhoto } from '@/features/auth/api/session';
import { qk } from '@/lib/queryKeys';
import { useProfileStore } from '@/store/profile.store';
import { color } from '@/theme/semantic';

const MAX_SCALE = 4;
/** What a double-tap zooms to, and back from. */
const TAP_SCALE = 2;

/**
 * The technician's own profile photo, full screen.
 *
 * Tapping the avatar lands HERE rather than on the change-photo sheet: the
 * common intent is to look at the picture, not replace it. Replacing it is the
 * camera badge's job, which is why that badge is its own tap target.
 *
 * Removal lives here too, and it is the only place it lives. It used to sit in
 * the picker sheet where it only ever cleared the local store — so the photo
 * came back on the next reload. Here it PERSISTS: `profileImageUrl: null` goes
 * to the server first, and the local copy is cleared only once that succeeded.
 */
export function PhotoViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const photo = useProfileStore((s) => s.avatarUri);
  const clearAvatar = useProfileStore((s) => s.clearAvatar);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  /** Keeps the zoomed image from being dragged off screen. */
  const clamp = () => {
    'worklet';
    const maxX = Math.max(0, (box.w * scale.value - box.w) / 2);
    const maxY = Math.max(0, (box.h * scale.value - box.h) / 2);

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
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      clamp();
    });

  // Double-tap toggles between fit and a fixed zoom, so getting back to the
  // whole picture never needs a careful pinch.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > 1 ? 1 : TAP_SCALE;
      scale.value = withTiming(next, { duration: 180 });
      savedScale.value = next;

      if (next === 1) {
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pan, pinch));

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const removePhoto = async () => {
    setBusy(true);
    try {
      // Server FIRST. Clearing the local copy on a request that then fails is
      // what made the old Remove look like it worked until the next reload.
      await saveMyProfilePhoto(null);
      clearAvatar();
      await queryClient.invalidateQueries({ queryKey: qk.me() });
      router.back();
    } catch {
      Alert.alert("Couldn't remove your photo", 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert('Remove photo?', 'Your profile picture will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: removePhoto },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.cameraBg }}>
      <ScreenStatusBar style="light" />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          {({ pressed }) => (
            <View style={{ opacity: pressed ? 0.6 : 1 }}>
              <Icon name="close" size={24} color={color.textInverse} />
            </View>
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
          Profile picture
        </Text>

        {/* Balances the close button so the title stays optically centred. */}
        <View style={{ width: 24 }} />
      </View>

      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(e) =>
          setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        {photo ? (
          <GestureDetector gesture={gesture}>
            <Animated.View style={[{ flex: 1 }, imageStyle]}>
              <Image
                source={{ uri: photo }}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
              />
            </Animated.View>
          </GestureDetector>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 24, paddingTop: 12 }}>
        <Text
          style={{
            textAlign: 'center',
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            color: color.cameraHint,
            marginBottom: 14,
          }}
        >
          Pinch to zoom · double-tap to fit
        </Text>

        <Button
          label="Remove photo"
          variant="dangerGhost"
          onPress={confirmRemove}
          disabled={busy}
        />
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
