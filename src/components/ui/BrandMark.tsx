import { Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface BrandMarkProps {
  size?: number;
  /** `full` renders the "V · Tech" lockup used on the sign-in screen. */
  variant?: 'mark' | 'full';
}

/** The blue "V" tile from the prototype's registration and sign-in screens. */
export function BrandMark({ size = 56, variant = 'mark' }: BrandMarkProps) {
  const full = variant === 'full';

  return (
    <View
      style={{
        height: size,
        width: full ? undefined : size,
        paddingHorizontal: full ? 20 : 0,
        borderRadius: radius.xl,
        backgroundColor: color.actionBg,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: size * 0.45,
          color: color.actionFg,
          letterSpacing: full ? 0.5 : 0,
        }}
      >
        {full ? 'V · Tech' : 'V'}
      </Text>
    </View>
  );
}
