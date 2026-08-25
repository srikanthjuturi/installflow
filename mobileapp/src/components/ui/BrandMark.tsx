import { Text, View } from 'react-native';

import { color } from '@/theme/semantic';

export interface BrandMarkProps {
  size?: number;
}

/**
 * The dark "RG" tile from the prototype's registration and sign-in screens.
 *
 * Exact values: 58×58, radius 17, #0e1622, white 22px/900 glyph. Identical on
 * both screens, so it lives here rather than being reproduced twice.
 *
 * The same mark is rendered server-side on the two public web pages
 * (api/app/features/onboarding/landing.py, api/app/features/tickets/slot_page.py)
 * at the same 22px — keep all three in step.
 */
export function BrandMark({ size = 58 }: BrandMarkProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 17,
        backgroundColor: color.chrome,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: size * 0.379, // 22 at 58
          letterSpacing: -0.4,
          color: color.textInverse,
        }}
      >
        RG
      </Text>
    </View>
  );
}
