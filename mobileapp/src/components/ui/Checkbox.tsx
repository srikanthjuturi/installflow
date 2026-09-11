import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Worded as a claim the person is making, not a box to clear. */
  label: string;
  disabled?: boolean;
}

/**
 * A tick box with its sentence.
 *
 * The whole row is the target, not the 22px box: this is pressed outdoors, in
 * gloves, and a label that does nothing when tapped is the one people try
 * first. `accessibilityRole="checkbox"` carries the state, so the fill is never
 * the only thing saying whether it is ticked.
 */
export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      hitSlop={6}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
            opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              borderWidth: checked ? 0 : 1.5,
              borderColor: color.borderStrong,
              backgroundColor: checked ? color.actionBg : color.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}
          >
            {checked ? <Icon name="check" size={13} color={color.actionFg} /> : null}
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily: 'Roboto_500Medium',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textPrimary,
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
