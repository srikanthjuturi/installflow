import { Image } from 'expo-image';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import type { CapturedShot } from '@/store/capture.store';
import { color } from '@/theme/semantic';

export interface ShotPreviewProps {
  shot: CapturedShot | null;
  title: string;
  /** What the destructive action says and does. Null hides it entirely. */
  action?: { label: string; onPress: () => void } | null;
  onClose: () => void;
}

/**
 * A captured image, full screen, before anything is submitted.
 *
 * This exists because tapping a tile on the review screen USED TO retake it —
 * one tap destroyed the capture and reopened the camera, with no confirmation
 * and no way back. Wanting a closer look at a photo is the far more common
 * intention, and it was the one action the screen did not offer.
 *
 * So a tap now shows the picture, and the destructive action is a labelled
 * button inside this sheet. Same number of taps to retake; you just cannot do
 * it by accident.
 */
export function ShotPreview({ shot, title, action, onClose }: ShotPreviewProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={!!shot}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
      // Android's back button must close this rather than leaving the flow —
      // `onRequestClose` is the only thing that hears it.
    >
      <View style={{ flex: 1, backgroundColor: color.cameraBg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingTop: insets.top + 10,
            paddingHorizontal: 16,
            paddingBottom: 10,
          }}
        >
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            {({ pressed }) => (
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? color.cameraTopControl : 'transparent',
                }}
              >
                <Icon name="chevronLeft" size={24} color={color.textInverse} />
              </View>
            )}
          </Pressable>

          <Text
            style={{ fontFamily: 'Roboto_700Bold', fontSize: 16, color: color.textInverse }}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>

        {shot ? (
          <Image
            source={{ uri: shot.uri }}
            // `contain`, not `cover`: this is the screen where a technician
            // decides whether the serial is readable. Cropping the edges is
            // exactly what would hide the reason to retake.
            contentFit="contain"
            style={{ flex: 1 }}
            transition={120}
          />
        ) : null}

        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            gap: 10,
          }}
        >
          {shot?.upload === 'failed' ? (
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 12.5,
                color: color.debit,
                textAlign: 'center',
              }}
            >
              {shot.error ?? "This one didn't upload."}
            </Text>
          ) : null}

          {action ? (
            <Button label={action.label} variant="dangerOutline" onPress={action.onPress} />
          ) : null}
          <Button label="Looks good" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
