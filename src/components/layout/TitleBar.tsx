import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface TitleBarProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: ReactNode;
}

/**
 * The white title bar used by the app's inner pages.
 *
 * Exact prototype values: white ground, 6/12/14 padding, a hairline in
 * neutral-100 rather than the standard border, a 40×40 r12 back target and a
 * 17px/700 title — noticeably lighter than the 20-26px black headings that
 * open the onboarding screens, because these pages are utilities rather than
 * introductions.
 */
export function TitleBar({ title, showBack = true, onBack, right }: TitleBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: color.surfaceRaised,
        paddingTop: insets.top + 6,
        paddingHorizontal: 12,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: palette.neutral[200],
      }}
    >
      {showBack ? (
        <Pressable onPress={handleBack} accessibilityRole="button" accessibilityLabel="Go back">
          {({ pressed }) => (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? color.surface : 'transparent',
              }}
            >
              <Icon name="chevronLeft" size={24} color={color.textPrimary} />
            </View>
          )}
        </Pressable>
      ) : (
        <View style={{ width: 12 }} />
      )}

      <Text
        style={{
          flex: 1,
          fontFamily: 'Roboto_700Bold',
          fontSize: 17,
          color: color.textPrimary,
        }}
        numberOfLines={1}
      >
        {title}
      </Text>

      {right}
    </View>
  );
}
