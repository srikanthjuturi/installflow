import { Pressable, View } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Track colour when on. Defaults to the action blue used on Availability. */
  activeColor?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/**
 * 44×26 track with a 20px knob, matching the prototype's toggles. Hand-rolled
 * rather than RN's Switch because the platform control can't be tinted to the
 * design on both platforms and looks obviously non-native to the mock.
 */
export function Switch({
  value,
  onValueChange,
  activeColor = color.actionBg,
  disabled = false,
  accessibilityLabel,
}: SwitchProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onValueChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      <View
        style={{
          width: 44,
          height: 26,
          borderRadius: radius.full,
          backgroundColor: value ? activeColor : color.borderStrong,
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: radius.full,
            backgroundColor: color.surfaceRaised,
            marginLeft: value ? 21 : 3,
          }}
        />
      </View>
    </Pressable>
  );
}
