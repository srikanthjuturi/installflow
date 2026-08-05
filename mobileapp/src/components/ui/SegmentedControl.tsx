import { Pressable, Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

/**
 * Prototype values: an #eef1f3 trough at radius 11 with 4px padding and a 2px
 * gutter; the active segment is a white r8 tile carrying a real shadow. The
 * shadow matters — without it the selected tab reads as a flat lighter patch
 * rather than something raised.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: color.surface,
        borderRadius: 11,
        padding: 4,
        gap: 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ flex: 1 }}
          >
            <View
              style={{
                paddingVertical: 9,
                paddingHorizontal: 4,
                borderRadius: 8,
                alignItems: 'center',
                backgroundColor: active ? color.surfaceRaised : 'transparent',
                shadowColor: palette.neutral[950],
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: active ? 0.1 : 0,
                shadowRadius: 2,
                elevation: active ? 2 : 0,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 12.5,
                  color: active ? color.textPrimary : color.textSecondary,
                }}
              >
                {option.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
