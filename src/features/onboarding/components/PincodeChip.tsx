import { Pressable, Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface PincodeChipProps {
  code: string;
  onRemove: () => void;
}

export function PincodeChip({ code, onRemove }: PincodeChipProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: color.surfaceSunken,
        borderRadius: radius.full,
        paddingLeft: 14,
        paddingRight: 8,
        paddingVertical: 8,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_500Medium', fontSize: 14, color: color.textPrimary }}>
        {code}
      </Text>

      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove pincode ${code}`}
      >
        {({ pressed }) => (
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.full,
              backgroundColor: color.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            }}
          >
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 13,
                lineHeight: 15,
                color: color.surfaceRaised,
              }}
            >
              ×
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
