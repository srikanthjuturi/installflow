import { Pressable, Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: color.surfaceSunken,
        borderRadius: radius.md,
        padding: 3,
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
                borderRadius: radius.sm,
                alignItems: 'center',
                backgroundColor: active ? color.surfaceRaised : 'transparent',
              }}
            >
              <Text
                style={{
                  fontFamily: active ? 'Roboto_700Bold' : 'Roboto_500Medium',
                  fontSize: 13,
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
