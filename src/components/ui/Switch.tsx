import { Pressable, View } from 'react-native';

import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Track colour when on. Defaults to the action blue used in list rows. */
  activeColor?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Renders without its own Pressable, for rows that are themselves tappable. */
  static?: boolean;
}

/**
 * 42×25 track with a 19px knob, matching the prototype's list toggles.
 *
 * Hand-rolled rather than RN's Switch: the platform control can't be tinted to
 * the design on both platforms and reads as obviously off-spec next to the
 * mock. The knob carries a real shadow, which is what stops it disappearing
 * against a light track in daylight.
 */
export function Switch({
  value,
  onValueChange,
  activeColor = color.actionBg,
  disabled = false,
  accessibilityLabel,
  static: isStatic = false,
}: SwitchProps) {
  const track = (
    <View
      style={{
        width: 42,
        height: 25,
        borderRadius: 999,
        backgroundColor: value ? activeColor : color.borderStrong,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 999,
          backgroundColor: color.surfaceRaised,
          marginLeft: value ? 20 : 3,
          shadowColor: palette.neutral[950],
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.2,
          shadowRadius: 2,
          elevation: 2,
        }}
      />
    </View>
  );

  if (isStatic) return track;

  return (
    <Pressable
      onPress={disabled ? undefined : () => onValueChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      {track}
    </Pressable>
  );
}
