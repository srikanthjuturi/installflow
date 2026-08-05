import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color } from '@/theme/semantic';

export interface SheetProps {
  children: ReactNode;
  onDismiss: () => void;
}

/**
 * Bottom sheet rendered inside a transparentModal route.
 *
 * Hand-rolled rather than @gorhom/bottom-sheet: this app needs one
 * non-draggable confirmation sheet, and that library is a large dependency
 * plus a native module that would break Expo Go.
 *
 * Prototype values: 26px top corners, 10/22/26 padding, a 40×5 grabber.
 */
export function Sheet({ children, onDismiss }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={{ flex: 1, backgroundColor: color.overlay }}
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(280)}
        style={{
          backgroundColor: color.surfaceRaised,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          paddingTop: 10,
          paddingHorizontal: 22,
          paddingBottom: insets.bottom + 26,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 5,
            borderRadius: 3,
            backgroundColor: color.grabber,
            marginBottom: 18,
          }}
        />
        {children}
      </Animated.View>
    </View>
  );
}
