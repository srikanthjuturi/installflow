import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface SheetProps {
  children: ReactNode;
  onDismiss: () => void;
}

/**
 * Bottom sheet rendered inside a transparentModal route.
 *
 * Hand-rolled rather than @gorhom/bottom-sheet: this app needs one
 * non-draggable confirmation sheet, and that library is a large dependency
 * plus a native module. Tapping the scrim dismisses; the panel itself doesn't
 * swallow the gesture by accident.
 */
export function Sheet({ children, onDismiss }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View entering={FadeIn.duration(180)} style={{ ...StyleSheetAbsoluteFill }}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={{ flex: 1, backgroundColor: color.overlay }}
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(240)}
        style={{
          backgroundColor: color.surfaceRaised,
          borderTopLeftRadius: radius['2xl'],
          borderTopRightRadius: radius['2xl'],
          paddingHorizontal: 20,
          paddingTop: 10,
          paddingBottom: insets.bottom + 20,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 4,
            borderRadius: radius.full,
            backgroundColor: color.borderStrong,
            marginBottom: 18,
          }}
        />
        {children}
      </Animated.View>
    </View>
  );
}

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
