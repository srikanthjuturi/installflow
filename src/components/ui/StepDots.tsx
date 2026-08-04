import { View } from 'react-native';

import { color } from '@/theme/semantic';

export interface StepDotsProps {
  total: number;
  /** 1-based. Every step up to and including this one reads as filled. */
  current: number;
}

/**
 * Onboarding progress bars — 22×5 pills from the prototype's registration
 * header. Filled steps are cumulative, so the technician can see how much of
 * the setup is left rather than only where they are.
 */
export function StepDots({ total, current }: StepDotsProps) {
  return (
    <View
      style={{ flexDirection: 'row', gap: 5 }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: 22,
            height: 5,
            borderRadius: 3,
            backgroundColor: i < current ? color.actionBg : color.border,
          }}
        />
      ))}
    </View>
  );
}
