import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { layout } from '@/theme/spacing';

export interface HeaderProps {
  title?: string;
  /** Small uppercase line above the title — job id, step counter. */
  eyebrow?: string;
  /** Larger intro paragraph under the title, as used on registration screens. */
  subtitle?: string;
  onBack?: () => void;
  showBack?: boolean;
  right?: ReactNode;
  /** `chrome` bleeds dark ink into the status bar; `light` sits on the page. */
  tone?: 'light' | 'chrome';
}

export function Header({
  title,
  eyebrow,
  subtitle,
  onBack,
  showBack = true,
  right,
  tone = 'light',
}: HeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const dark = tone === 'chrome';
  const titleColor = dark ? color.textInverse : color.textPrimary;
  const mutedColor = dark ? color.textMuted : color.textSecondary;

  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
  };

  return (
    <View
      style={{
        backgroundColor: dark ? color.chrome : color.surface,
        paddingTop: insets.top + 12,
        paddingBottom: 16,
        paddingHorizontal: layout.screenGutter,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
        {showBack ? (
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{ marginLeft: -6, marginRight: 6 }}
          >
            {({ pressed }) => (
              <View style={{ opacity: pressed ? 0.5 : 1, padding: 4 }}>
                <Icon name="chevronLeft" size={24} color={titleColor} />
              </View>
            )}
          </Pressable>
        ) : null}

        <View style={{ flex: 1 }}>
          {eyebrow ? (
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 11,
                letterSpacing: 1.4,
                color: mutedColor,
                marginBottom: 2,
              }}
            >
              {eyebrow.toUpperCase()}
            </Text>
          ) : null}
          {title ? (
            <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: titleColor }}>
              {title}
            </Text>
          ) : null}
        </View>

        {right}
      </View>

      {subtitle ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13,
            lineHeight: 19,
            color: mutedColor,
            marginTop: 8,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
