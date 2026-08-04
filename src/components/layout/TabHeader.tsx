import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface TabHeaderProps {
  title: string;
  /** Rendered inside the white bar, below the title — e.g. a segmented control. */
  children?: ReactNode;
}

/**
 * Header for the four tab roots.
 *
 * The title is 20px/900 here versus TitleBar's 17px/700, because a tab root is
 * a destination rather than a page you drilled into — the prototype makes that
 * distinction consistently and it's what tells you whether Back exists.
 */
export function TabHeader({ title, children }: TabHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: color.surfaceRaised,
        paddingTop: insets.top + 10,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: palette.neutral[200],
      }}
    >
      <Text
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: 20,
          color: color.textPrimary,
          paddingTop: 4,
          paddingHorizontal: 2,
          paddingBottom: 12,
        }}
      >
        {title}
      </Text>

      {children}
    </View>
  );
}
