import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  /** `flat` drops the border — for cards sitting on a tinted panel. */
  variant?: 'default' | 'flat';
  padded?: boolean;
  style?: ViewStyle;
}

export function Card({
  children,
  onPress,
  variant = 'default',
  padded = true,
  style,
}: CardProps) {
  const base: ViewStyle = {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: variant === 'default' ? 1 : 0,
    borderColor: color.border,
    padding: padded ? 16 : 0,
    ...style,
  };

  if (!onPress) return <View style={base}>{children}</View>;

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => <View style={{ ...base, opacity: pressed ? 0.7 : 1 }}>{children}</View>}
    </Pressable>
  );
}
