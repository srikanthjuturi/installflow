import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color } from '@/theme/semantic';
import { layout } from '@/theme/spacing';

/**
 * Page shell. Screens never touch SafeAreaView or StatusBar directly — the
 * variant decides both, so the chrome stays consistent across 18 screens.
 *
 *  light  — white/surface page, dark status text (registration, forms, lists)
 *  chrome — dark ink header bleeding into the status bar (Home, Offer, Detail,
 *           Earnings, Profile)
 *  camera — full-bleed black, no insets applied to content (capture screens)
 */
export type ScreenVariant = 'light' | 'chrome' | 'camera';

export interface ScreenProps {
  children: ReactNode;
  variant?: ScreenVariant;
  /** Wrap children in a ScrollView. Off for camera and fixed-height screens. */
  scroll?: boolean;
  /** Pinned to the bottom, outside the scroll area — primary CTAs. */
  footer?: ReactNode;
  /** Horizontal padding. Off when children manage their own gutters. */
  padded?: boolean;
}

const BACKGROUND: Record<ScreenVariant, string> = {
  light: color.surface,
  chrome: color.surface,
  camera: color.cameraBg,
};

export function Screen({
  children,
  variant = 'light',
  scroll = true,
  footer,
  padded = true,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const gutter = padded ? layout.screenGutter : 0;

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingBottom: footer ? layout.screenGutter : insets.bottom + layout.screenGutter,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingHorizontal: gutter }}>{children}</View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: BACKGROUND[variant] }}>
      <StatusBar style={variant === 'light' ? 'dark' : 'light'} />
      {content}
      {footer ? (
        <View
          style={{
            paddingHorizontal: layout.screenGutter,
            paddingTop: 12,
            paddingBottom: insets.bottom + 12,
            backgroundColor: color.surfaceRaised,
            borderTopWidth: 1,
            borderTopColor: color.border,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
