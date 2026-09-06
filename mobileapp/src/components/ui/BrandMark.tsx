import { Text, View } from 'react-native';

import { useBrand } from '@/hooks/useBrand';
import { color } from '@/theme/semantic';

export interface BrandMarkProps {
  size?: number;
  /**
   * The letters to draw. Defaults to whatever `useBrand` resolves — the
   * technician's company once signed in, the platform mark before that.
   * Pass one explicitly only where the brand is already known for another
   * reason, such as an invite naming the company doing the inviting.
   */
  mark?: string;
}

/**
 * The dark brand tile from the prototype's registration and sign-in screens.
 *
 * Exact values: 58×58, radius 17, #0e1622, white 22px/900 glyph. Identical on
 * both screens, so it lives here rather than being reproduced twice.
 *
 * **What it says is no longer fixed.** It draws the signed-in technician's
 * company code, because this app is multi-tenant and the person holding the
 * phone works for one of those companies, not for the platform. `RG` survives
 * only as the fallback for the login screen, where a phone number has not yet
 * said which company it belongs to.
 *
 * The same tile is rendered server-side on the three public web pages
 * (onboarding/landing.py, tickets/slot_page.py, tickets/feedback_page.py) at
 * the same 22px. Those follow the same rule with one deliberate exception:
 * the invite landing page stays platform-marked because it never resolves its
 * token — see its docstring.
 */
export function BrandMark({ size = 58, mark }: BrandMarkProps) {
  const brand = useBrand();
  const letters = mark ?? brand.mark;
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
        // A code may be up to six characters, and the tile is a fixed square,
        // so anything past two steps down rather than overflowing it.
        numberOfLines={1}
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: size * (letters.length > 3 ? 0.24 : 0.379), // 22 at 58
          letterSpacing: -0.4,
          color: color.textInverse,
        }}
      >
        {letters}
      </Text>
    </View>
  );
}
